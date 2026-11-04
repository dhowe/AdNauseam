import {
    CompiledListReader,
    CompiledListWriter,
} from '../src/js/static-filtering-io.js';
import { canUsePopupPreflight, createWhitelistMatcher, installPopupPreflight } from '../src/js/popup-preflight.js';
import { AstFilterParser } from '../src/js/static-filtering-parser.js';
import DynamicHostRuleFiltering from '../src/js/dynamic-net-filtering.js';
import DynamicURLRuleFiltering from '../src/js/url-net-filtering.js';
import { FilteringContext } from '../src/js/filtering-context.js';
import assert from 'node:assert/strict';
import { domainFromHostname } from '../src/js/uri-utils.js';
import publicSuffixList from '../src/lib/publicsuffixlist/publicsuffixlist.js';
import snfe from '../src/js/static-net-filtering.js';
import test from 'node:test';
import vm from 'node:vm';

publicSuffixList.parse('com\norg\nnet\ntest\nco.uk\ngithub.io\n');

function compile(filters) {
    snfe.reset();
    const compiler = snfe.createCompiler();
    const parser = new AstFilterParser();
    const writer = new CompiledListWriter();
    for ( const line of filters ) {
        parser.parse(line);
        assert.equal(parser.isNetworkFilter(), true, line);
        assert.equal(compiler.compile(parser, writer), true, line);
    }
    snfe.fromCompiled(new CompiledListReader(writer.toString()));
    snfe.freeze();
    snfe.optimize(0);
}

function page(origin = 'https://watch.test/movie', trust = '', { subframe = false, origins, details } = {}) {
    const calls = [];
    const location = new URL(origin);
    location.ancestorOrigins = origins;
    const docHostname = location.hostname;
    const listeners = new Map();
    const document = { location, baseURI: location.href,
        addEventListener(type, fn) { listeners.set(type, fn); },
    };
    const self = { open(...args) { calls.push({ args, receiver: this }); return { allowed: true }; } };
    self.top = subframe ? { get location() { throw new Error('Cross origin'); } } : { location };
    const trustedData = new Map();
    for ( const directive of trust.split('\n').filter(Boolean) ) {
        const key = directive.includes('/') ? '//' : directive;
        trustedData.set(key, [...(trustedData.get(key) ?? []), directive]);
    }
    const scope = { self, document, URL };
    const config = details ?? { ...snfe.popupPreflight, hostname: docHostname, domain: domainFromHostname(docHostname) };
    vm.runInNewContext(`(${installPopupPreflight.toString()})(` +
        `${JSON.stringify(config)},(${createWhitelistMatcher.toString()})().matches,${JSON.stringify([...trustedData])});`, scope);
    return { self, calls, scope, document, listeners };
}

function backgroundDecision(destination, origin) {
    const fctxt = new FilteringContext()
        .setURL(new URL(destination, origin).href)
        .setDocOriginFromURL(origin)
        .setTabOriginFromURL(origin)
        .setType('popup');
    return snfe.matchRequest(fctxt, 0b0001);
}

test('only exact hostname popup blocks are exported; badfilters are honored', () => {
    compile([
        '||ads.test^$popup', '||network.test^', '||under.test^$popunder',
        '||gone.test^$popup', '||gone.test^$popup,badfilter',
        '/advert/$popup', '||scoped.test^$popup,domain=watch.test',
    ]);
    assert.deepEqual(snfe.popupPreflight.block.map(a => a.hostname), ['ads.test']);
    const p = page();
    assert.equal(p.self.open('https://ads.test/'), null);
    assert.equal(p.calls.length, 0);
    p.self.open('https://network.test/');
    p.self.open('https://gone.test/');
    assert.equal(p.calls.length, 2);
});

test('shared whitelist matcher preserves domains, exact URLs, wildcards, regexes and bucket offsets', () => {
    const matcher = createWhitelistMatcher();
    const data = new Map([
        ['trusted.test', ['trusted.test']],
        ['watch.test', ['https://watch.test/private', 'https://watch.test/path/*']],
        ['//', ['/https:\\/\\/other\\.test\\/allowed/']],
    ]);
    assert.equal(matcher.matches(data, 'https://sub.trusted.test/', 'sub.trusted.test'), true);
    assert.equal(matcher.matches(data, 'https://untrusted.test/', 'untrusted.test'), false);
    assert.equal(matcher.matches(data, 'https://watch.test/private', 'watch.test'), true);
    assert.equal(matcher.matches(data, 'https://watch.test/private-more', 'watch.test'), false);
    assert.equal(matcher.matches(data, 'https://watch.test/path/chapter', 'watch.test'), true);
    assert.equal(matcher.matches(data, 'https://other.test/allowed', 'other.test'), true);
    assert.equal(matcher.matches(data, 'https://other.test/no', 'other.test'), false);
    assert.equal(matcher.matchBucket('https://watch.test/private', 'watch.test', data.get('watch.test'), 1), -1);
    assert.ok(matcher.regexpCache.size > 0);
    matcher.regexpCache.clear();
    assert.equal(matcher.regexpCache.size, 0);
});

test('allowed calls keep arguments, receiver, relative URLs, and return values', () => {
    compile(['||ads.test^$popup']);
    const p = page();
    assert.equal(p.self.open('/chapter', 'reader', 'width=400').allowed, true);
    assert.deepEqual(Array.from(p.calls[0].args), ['/chapter', 'reader', 'width=400']);
    assert.equal(p.calls[0].receiver, p.self);
    let conversions = 0;
    p.self.open({ toString() { conversions++; return 'https://safe.test'; } });
    assert.equal(conversions, 1);
    assert.throws(() => p.self.open(Symbol('invalid')), { name: 'TypeError' });
    p.self.open('https://ads.test', '_self');
    p.self.open('');
    p.self.open('about:blank');
    p.self.open('javascript:void(0)');
    assert.equal(p.calls.length, 6);
});

test('popup exceptions retain URL and hostname conditions and important precedence', () => {
    compile([
        '||ads.test^$popup', '@@||ads.test/login$popup,domain=watch.test',
        '||required.test^$popup,important', '@@||required.test^$popup',
    ]);
    const p = page();
    assert.equal(p.self.open('https://ads.test/login').allowed, true);
    assert.equal(p.self.open('https://ads.test/ad'), null);
    assert.equal(p.self.open('https://required.test'), null);
    const other = page('https://other.test/');
    assert.equal(other.self.open('https://ads.test/login'), null);
});

test('generic network exceptions do not bypass exact-type popup rules', () => {
    compile(['||ads.test^$popup', '@@||ads.test^']);
    assert.equal(page().self.open('https://ads.test'), null);
});

test('empty and named windows are preserved even on a popup-blocked source host', () => {
    compile(['||watch.test^$popup']);
    const p = page();
    assert.equal(p.self.open().allowed, true);
    assert.equal(p.self.open('').allowed, true);
    assert.equal(p.self.open('https://watch.test/', 'existing').allowed, true);
});

test('a trusted clicked link retains the existing same-frame popup heuristic', () => {
    compile(['||ads.test^$popup']);
    const p = page();
    const target = { closest: () => ({ href: 'http://ads.test/login' }) };
    p.listeners.get('mousedown')({ isTrusted: true, target });
    assert.equal(p.self.open('https://ads.test/login').allowed, true);
    assert.equal(p.self.open('https://ads.test/advert'), null);
});

test('unsupported exception conditions broaden permission rather than blocking an allowed call', () => {
    compile(['||ads.test^$popup', '@@||ads.test/login$popup,domain=watch.*']);
    const p = page('https://watch.test/');
    assert.equal(p.self.open('https://ads.test/login').allowed, true);
    assert.equal(p.self.open('https://ads.test/advert'), null);
});

test('first/third-party rules agree with the network engine for registrable domains', () => {
    compile(['||ads.test^$popup,3p', '||watch.co.uk^$popup,1p']);
    const p = page('https://www.watch.co.uk/');
    assert.equal(p.self.open('https://ads.test'), null);
    assert.equal(p.self.open('https://cdn.watch.co.uk/ad'), null);
    const same = page('https://www.ads.test/');
    assert.equal(same.self.open('https://ads.test').allowed, true);
});

test('trusted opener/destination and cross-origin frames fail open when trust is uncertain', () => {
    compile(['||ads.test^$popup']);
    assert.equal(page(undefined, 'watch.test').self.open('https://ads.test').allowed, true);
    assert.equal(page(undefined, 'ads.test').self.open('https://ads.test').allowed, true);
    assert.equal(page(undefined, '', { subframe: true }).self.open('https://ads.test').allowed, true);
    const origins = { length: 1, item: () => 'https://parent.test' };
    assert.equal(page(undefined, 'parent.test', { subframe: true, origins }).self.open('https://ads.test').allowed, true);
    assert.equal(page(undefined, 'https://parent.test/private', { subframe: true, origins }).self.open('https://ads.test').allowed, true);
    assert.equal(page(undefined, '', { subframe: true, origins }).self.open('https://ads.test'), null);
});

test('snapshot restoration preserves preflight decisions', () => {
    compile(['||ads.test^$popup', '@@||ads.test/login$popup']);
    const selfie = structuredClone(snfe.toSelfie());
    snfe.reset();
    assert.equal(snfe.fromSelfie(selfie), true);
    const p = page();
    assert.equal(p.self.open('https://ads.test/ad'), null);
    assert.equal(p.self.open('https://ads.test/login').allowed, true);
});

test('preflight blocking implies a block in the real engine across contexts and URL variants', () => {
    const rules = [
        '||ads.test^$popup', '||partner.test^$popup,3p', '||watch.test^$popup,1p',
        '||forced.test^$popup,important', '@@||forced.test^$popup',
        '@@||ads.test/login$popup,domain=watch.test|reader.test',
        '@@||partner.test/auth$popup,3p',
        '@@/ads\\.test\\/oauth/$popup',
        '@@||ads.test/skip$popup,to=~denied.ads.test',
        '@@*$popup,domain=trusted.test',
        '@@||ads.test/regex$popup,domain=/reader/',
    ];
    compile(rules);
    let blocked = 0;
    let checked = 0;
    for ( const origin of ['https://watch.test/', 'https://reader.test/', 'https://trusted.test/', 'https://ads.test/', 'https://unrelated.co.uk/'] ) {
        const p = page(origin);
        for ( const host of ['ads.test', 'x.ads.test', 'notads.test', 'ads.test.evil.test', 'denied.ads.test', 'partner.test', 'watch.test', 'forced.test'] ) {
            for ( const path of ['/', '/login', '/auth', '/oauth', '/skip', '/regex', '/advert?redirect=ads.test'] ) {
                for ( const scheme of ['http', 'https'] ) {
                    const destination = `${scheme}://${host}${path}`;
                    const result = p.self.open(destination);
                    checked++;
                    if ( result !== null ) { continue; }
                    blocked++;
                    assert.equal(backgroundDecision(destination, origin), 1, `${origin} -> ${destination}`);
                }
            }
        }
    }
    assert.equal(checked, 560);
    assert.ok(blocked > 100, `Meaningful prevention coverage: ${blocked}`);
});

test('stock behind-the-scene rules allow preflight; page dynamic overrides disable it', () => {
    const firewall = new DynamicHostRuleFiltering();
    const urls = new DynamicURLRuleFiltering();
    firewall.fromString('behind-the-scene * * noop\nbehind-the-scene * image noop');
    assert.equal(canUsePopupPreflight(firewall, urls), true);
    firewall.fromString('watch.test ads.test * allow');
    assert.equal(canUsePopupPreflight(firewall, urls), false);
    firewall.reset();
    urls.fromString('watch.test https://ads.test/ popup allow');
    assert.equal(canUsePopupPreflight(firewall, urls), false);
});

test('URL normalization and hostile hostname lookalikes do not introduce a stronger block', () => {
    compile(['||ads.test^$popup']);
    const origin = 'https://watch.test/';
    const p = page(origin);
    for ( const destination of [
        'https://ADS.TEST/', 'https://ads.test./', 'https://ads.test:443/',
        'https://ads.test@safe.test/', 'https://safe.test/?next=https://ads.test/',
        'https://safe.test/ads.test', 'https://notads.test/',
        'https://ads.test.evil.test/', 'https://user:pass@ads.test/',
    ] ) {
        if ( p.self.open(destination) === null ) {
            assert.equal(backgroundDecision(destination, origin), 1, destination);
        }
    }
});
