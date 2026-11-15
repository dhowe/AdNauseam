const QUnit = window.QUnit;

QUnit.config.testTimeout = 5000;
QUnit.module('Ad parser', {
    afterEach(assert) {
        for ( const frame of document.querySelectorAll('#qunit-fixture iframe') ) {
            const win = frame.contentWindow;
            try {
                const errors = win.testErrors || [];
                assert.deepEqual([...errors], [], 'Frame does not raise uncaught errors');
            } finally {
                try {
                    win.vAPI?.shutdown.exec();
                } finally {
                    frame.remove();
                }
            }
        }
    },
});

QUnit.test('Parser bookkeeping produces no DOM attribute mutations', async function(assert) {
    const { win, doc } = await fixture();
    const node = doc.createElement('div');
    doc.body.append(node);
    const observer = new win.MutationObserver(() => {});
    observer.observe(node, { attributes: true, subtree: true });
    try {
        win.vAPI.adCheck(node);
        assert.strictEqual(observer.takeRecords().length, 0, 'Parser does not mutate DOM attributes');
        assert.notOk(node.hasAttribute('process-adn'), 'Parser keeps processed timestamps out of the DOM');
    } finally {
        observer.disconnect();
    }
});

QUnit.test('Cooldown and explicit invalidation still allow later rescans', async function(assert) {
    const { win, doc } = await fixture();
    const node = doc.createElement('div');
    let scans = 0;
    let now = 0;
    const dateNow = win.Date.now;
    win.Date.now = () => now;
    win.vAPI.textAdParser.process = () => { scans++; };
    try {
        win.vAPI.adCheck(node);
        win.vAPI.adCheck(node);
        assert.strictEqual(scans, 1, 'Element is scanned once during the cooldown');
        now = 3000;
        win.vAPI.adCheck(node);
        assert.strictEqual(scans, 2, 'Element is rescanned after the cooldown');
        assert.ok(win.vAPI.adParser.resetProcessed(node), 'Processed state can be reset');
        win.vAPI.adCheck(node);
        assert.strictEqual(scans, 3, 'Resetting processed state allows an immediate rescan');
    } finally {
        win.Date.now = dateNow;
    }
});

QUnit.test('An editor reacting to attribute changes is not driven into a rebuild loop', async function(assert) {
    const { win, doc } = await fixture();
    const editor = doc.createElement('div');
    editor.contentEditable = 'true';
    doc.body.append(editor);
    const node = doc.createElement('span');
    node.textContent = 'Editor text';
    let rebuilds = 0;
    const observer = new win.MutationObserver(records => {
        if ( !records.some(record => record.type === 'attributes') ) { return; }
        rebuilds++;
        if ( rebuilds >= 12 ) {
            observer.disconnect();
            return;
        }
        const replacement = doc.createElement('span');
        replacement.textContent = 'Editor text';
        editor.replaceChildren(replacement);
    });
    observer.observe(editor, { attributes: true, subtree: true });
    try {
        editor.append(node);
        win.vAPI.adCheck(node);
        await win.testFlushDOM();
        assert.strictEqual(rebuilds, 0, 'Parsing does not trigger editor rebuilds');
        assert.strictEqual(editor.firstChild, node, 'Editor retains its original text node');
    } finally {
        observer.disconnect();
    }
});

QUnit.test('Real domCollapser invalidates the nearest processed ancestor', async function(assert) {
    const { win, doc } = await fixture();
    const outer = doc.createElement('div');
    const container = doc.createElement('div');
    outer.append(container);
    doc.body.append(outer);
    await win.testFlushDOM();
    const scanned = [];
    win.vAPI.textAdParser.process = node => { scanned.push(node); };
    win.vAPI.adCheck(container);
    scanned.length = 0;
    container.append(doc.createElement('span'));
    await win.testFlushDOM();
    assert.ok(scanned.includes(container), 'Changed container is rescanned');
    assert.notOk(scanned.includes(outer), 'Rescanning stops at the nearest processed ancestor');
    assert.strictEqual(doc.querySelector('[process-adn]'), null, 'Invalidation keeps processed state outside the DOM');
});

QUnit.test('Direct image parsing collects on first visit and deduplicates repeats', async function(assert) {
    const { win, doc } = await fixture();
    const { image, link } = await adImage(win, doc);
    doc.body.append(link);
    win.vAPI.adCheck(image);
    win.vAPI.adCheck(image);
    assert.strictEqual(win.testAds.length, 1, 'Image ad is collected once across repeated scans');
    assert.strictEqual(win.testAds[0]?.targetUrl, link.href, 'Image ad keeps its click target');
});

QUnit.test('New image ads inside an already scanned container are still collected', async function(assert) {
    const { win, doc } = await fixture();
    const container = doc.createElement('div');
    doc.body.append(container);
    win.vAPI.adCheck(container);
    await win.testFlushDOM();
    const { image, link } = await adImage(win, doc);
    container.append(link);
    await win.testFlushDOM();
    assert.ok(win.testAds.length > 0, 'Dynamically added image ad is collected');
    assert.strictEqual(win.testAds[0]?.contentData.src, image.src, 'Collected ad uses the dynamically added image');
});

QUnit.test('A gradient background is not collected as an image ad', async function(assert) {
    const { win, doc } = await fixture();
    const link = doc.createElement('a');
    link.href = 'https://ads.example/landing';
    const gradient = doc.createElement('div');
    gradient.style.cssText = 'width:300px;height:250px;background:linear-gradient(0deg, rgb(255, 255, 255) 0%, rgb(0, 0, 0) 100%)';
    link.append(gradient);
    doc.body.append(link);
    win.vAPI.adCheck(gradient);
    assert.strictEqual(win.testAds.length, 0, 'Gradient-only background yields no ad');

    const { image } = await adImage(win, doc);
    const banner = doc.createElement('div');
    banner.style.cssText = 'width:300px;height:250px;background-image:linear-gradient(0deg, rgb(255, 255, 255) 0%, rgb(0, 0, 0) 100%), url("' + image.src + '")';
    const bannerLink = doc.createElement('a');
    bannerLink.href = 'https://ads.example/banner';
    bannerLink.append(banner);
    doc.body.append(bannerLink);
    win.vAPI.adCheck(banner);
    assert.strictEqual(win.testAds.length, 1, 'Background with a url() is still collected');
    assert.strictEqual(win.testAds[0]?.contentData.src, image.src, 'The url() is used, not the gradient arguments');
});

QUnit.test('Images of unknown natural size are size-checked by their rendered size', async function(assert) {
    const { win, doc } = await fixture();
    const { image } = await adImage(win, doc);
    const lazyAd = function(size, target) {
        const lazy = doc.createElement('img');
        lazy.alt = 'Lazy ad';
        lazy.setAttribute('data-src', image.src);
        lazy.style.cssText = 'display:block;' + size;
        const link = doc.createElement('a');
        link.href = target;
        link.append(lazy);
        doc.body.append(link);
        return lazy;
    };
    win.vAPI.adCheck(lazyAd('width:20px;height:20px', 'https://ads.example/small'));
    assert.strictEqual(win.testAds.length, 0, 'An unloaded 20x20 image is too small to be an ad');
    win.vAPI.adCheck(lazyAd('width:300px;height:250px', 'https://ads.example/large'));
    assert.strictEqual(win.testAds.length, 1, 'An unloaded 300x250 image is still collected');
});

QUnit.test('Nearby script source is not used as an image ad title', async function(assert) {
    const { win, doc } = await fixture();
    const container = doc.createElement('div');
    const { image, link } = await adImage(win, doc);
    image.removeAttribute('alt');
    container.append(link);
    const config = doc.createElement('div');
    config.innerHTML = '<script>window["cnftData"]={"d":{"wh":"N29EZ2lUc3E4OFVTNHJyQkcwX054cGFma3JnLzIwOTU2Mzk2NTc6OTcweDI1MA==","wd":970}};</script>';
    container.append(config);
    const hidden = doc.createElement('div');
    hidden.style.display = 'none';
    hidden.innerHTML = '<div><script>var hidden = 1;</script></div>';
    container.append(hidden);
    const label = doc.createElement('p');
    label.textContent = 'Advertisement';
    container.append(label);
    doc.body.append(container);
    win.vAPI.adCheck(image);
    assert.strictEqual(win.testAds.length, 1, 'Image ad next to script blocks is collected');
    assert.strictEqual(win.testAds[0]?.title, 'Advertisement', 'Title skips script source and uses the nearby label');
});

QUnit.test('Same-origin video posters are ignored in srcdoc frames', async function(assert) {
    const { win, doc } = await fixture();
    assert.strictEqual(win.location.origin, 'null', 'srcdoc location reports a null origin');
    assert.strictEqual(win.origin, window.origin, 'srcdoc inherits its parent origin');
    assert.notStrictEqual(win.origin, 'null', 'Parent page has an HTTP origin');
    const base = doc.createElement('base');
    base.href = `${window.origin}/assets/videos/`;
    doc.head.append(base);
    const posters = ['/poster.jpg', 'poster.jpg', '../poster.jpg', `//${window.location.host}/poster.jpg`];
    for ( const poster of posters ) {
        const { video } = adVideo(doc, poster);
        win.testAds.length = 0;
        win.vAPI.adCheck(video);
        assert.strictEqual(win.testAds.length, 0, `Same-origin poster ${poster} is ignored`);
    }
});

QUnit.test('Relative video posters resolve against the element base URI', async function(assert) {
    const { win, doc } = await fixture();
    const origin = 'https://cdn.example';
    const base = doc.createElement('base');
    base.href = `${origin}/assets/videos/`;
    doc.head.append(base);
    assert.strictEqual(win.origin, window.origin, 'External base URL preserves the frame origin');
    assert.notStrictEqual(win.origin, origin, 'Poster CDN has a different origin from the frame');
    const posters = [
        { value: '/poster.jpg', expected: `${origin}/poster.jpg` },
        { value: 'poster.jpg', expected: `${origin}/assets/videos/poster.jpg` },
        { value: '../poster.jpg', expected: `${origin}/assets/poster.jpg` },
    ];
    for ( const { value, expected } of posters ) {
        const { video } = adVideo(doc, value);
        win.testAds.length = 0;
        win.vAPI.adCheck(video);
        assert.strictEqual(win.testAds.length, 1, `External poster ${value} is collected`);
        assert.strictEqual(win.testAds[0]?.contentData.src, expected, 'Poster URL is resolved against the element base URI');
    }
});

QUnit.test('Missing, empty and malformed video posters are ignored', async function(assert) {
    const { win, doc } = await fixture();
    for ( const poster of [null, '', '   ', '//[invalid/poster.jpg', 'http://[', 'https://['] ) {
        const { video } = adVideo(doc, poster);
        win.vAPI.adCheck(video);
        assert.strictEqual(win.testAds.length, 0, `Missing or invalid poster ${poster} is ignored`);
    }
    const base = doc.createElement('base');
    base.href = 'about:blank';
    doc.head.append(base);
    const { video } = adVideo(doc, '/poster.jpg');
    win.vAPI.adCheck(video);
    assert.strictEqual(win.testAds.length, 0, 'Relative poster with an unusable base URL is ignored');
});

QUnit.test('Video posters do not interrupt collection of subsequent filtered ads', async function(assert) {
    const { win, doc } = await fixture({ deferBootstrap: true });
    const videos = [];
    for ( const poster of ['/poster.jpg', '//[invalid/poster.jpg', '   '] ) {
        const { video, link } = adVideo(doc, poster);
        video.className = 'poster-test';
        doc.body.append(link);
        videos.push(video);
    }
    const { image, link } = await adImage(win, doc);
    image.className = 'poster-test';
    doc.body.append(link);
    const visited = [];
    const adCheck = win.vAPI.adCheck;
    win.vAPI.adCheck = node => {
        visited.push(node);
        adCheck(node);
    };
    await win.testApplyFilters('.poster-test {}');
    assert.ok(visited.includes(image), 'Filter scan reaches the image after videos');
    assert.ok(videos.every(video => visited.includes(video)), 'Filter scan visits every matching video');
    assert.strictEqual(win.testAds.length, 1, 'Filter scan collects only the image ad after local and invalid posters');
    assert.ok(win.testAds.some(ad => ad.contentData.src === image.src), 'Image ad after videos is collected');
});

QUnit.test('Text filter referrer is parsed once across many added nodes', async function(assert) {
    const { win, doc } = await fixture();
    Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://editor.example/document/' });
    const NativeURL = win.URL;
    let urlParses = 0;
    win.URL = class extends NativeURL {
        constructor(...args) {
            super(...args);
            urlParses++;
        }
    };
    const node = doc.createElement('div');
    for ( let i = 0; i < 1000; i++ ) { win.vAPI.textAdParser.process(node); }
    assert.strictEqual(urlParses, 1, 'Referrer URL is parsed once across repeated checks');
    Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://editor.example/another/' });
    for ( let i = 0; i < 1000; i++ ) { win.vAPI.textAdParser.process(node); }
    assert.strictEqual(urlParses, 2, 'Changed referrer is parsed once even when its domain is unchanged');
});

QUnit.test('Missing or malformed referrers do not break text ad parsing', async function(assert) {
    const { win, doc } = await fixture();
    for ( const referrer of ['', 'about:blank', 'https://example.com/%ZZ', 'https://[/'] ) {
        Object.defineProperty(doc, 'referrer', { configurable: true, value: referrer });
        win.vAPI.textAdParser.process(doc.createElement('div'));
    }
    assert.strictEqual(win.testAds.length, 0, 'Malformed referrers do not produce text ads');
});

QUnit.test('Cached text filters still collect ads on supported domains', async function(assert) {
    const { win, doc } = await fixture();
    const node = doc.createElement('div');
    node.className = 'ad';
    node.innerHTML = '<div class="title"><a href="https://ads.example/text"><span>Example</span></a></div>' +
        '<div class="desc"><span>Description</span></div><div class="durl"><span>ads.example</span></div>';
    doc.body.append(node);
    Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://example.com/' });
    win.vAPI.textAdParser.process(node);
    assert.strictEqual(win.testAds.length, 0, 'Text ads are ignored on unsupported domains');
    Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://www.aol.com/' });
    win.vAPI.textAdParser.process(node);
    assert.ok(win.testAds.some(ad => ad.contentType === 'text' && ad.targetUrl === 'https://ads.example/text'), 'Text ad is collected on a supported domain');
    for ( const referrer of ['https://www.aol.com/%ZZ', '', 'https://example.com/'] ) {
        win.testAds.length = 0;
        Object.defineProperty(doc, 'referrer', { configurable: true, value: referrer });
        win.vAPI.textAdParser.process(node);
        assert.strictEqual(win.testAds.length, 0, 'Changing the referrer discards previously matched filters');
    }
    Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://www.aol.com/' });
    win.vAPI.textAdParser.process(node);
    assert.strictEqual(win.testAds.length, 1, 'Returning to a supported referrer restores its filters');
});

QUnit.test('Google ads without a display url fall back to the target domain', async function(assert) {
    const { win, doc } = await fixture();
    Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://www.google.com/search?q=sneaker' });
    const clickUrl = 'https://www.googleadservices.com/pagead/aclk?sa=L&amp;adurl=https://www.ads.example/sneaker';
    const googleAd = (site, href = clickUrl) => {
        const node = doc.createElement('div');
        node.setAttribute('data-text-ad', '1');
        node.innerHTML = '<div><div role="heading"><span>Example Sneaker</span></div>' +
            '<a data-rw="' + href + '" href="' + href + '">' +
            (site ? '<span data-dtld="' + site + '">' + site + '</span>' : '') + '</a>' +
            '<div>Sneakers for the whole day, in store now</div></div>';
        doc.body.append(node);
        return node;
    };
    win.vAPI.textAdParser.process(googleAd('shop.example'));
    assert.strictEqual(win.testAds.length, 1, 'Ad with a display url is collected');
    assert.strictEqual(win.testAds[0].contentData.site, 'shop.example', 'Display url is used as the site');
    win.testAds.length = 0;
    win.vAPI.textAdParser.process(googleAd(null));
    assert.strictEqual(win.testAds.length, 1, 'Ad without a display url is still collected');
    assert.strictEqual(win.testAds[0].contentData.site, 'www.ads.example', 'Target domain is used as the site');
    win.testAds.length = 0;
    win.vAPI.textAdParser.process(googleAd(null, '/goto?url=CAESZAHrOzAVwE05'));
    assert.strictEqual(win.testAds.length, 1, 'Ad with a page-relative target is still collected');
    assert.strictEqual(win.testAds[0].contentData.site, new URL(doc.baseURI).hostname,
        'Page host is used as the site for a relative target');
});

QUnit.test('Whitelisted frames do not start ad scanning', async function(assert) {
    const { win, doc } = await fixture({ whitelisted: true });
    let scans = 0;
    win.vAPI.adCheck = () => { scans++; };
    const { link } = await adImage(win, doc);
    doc.body.append(link);
    await win.testFlushDOM();
    assert.strictEqual(scans, 0, 'Whitelisted frame is not scanned');
    assert.strictEqual(win.testAds.length, 0, 'Whitelisted frame does not collect ads');
});

QUnit.test('Stopping content scripts disconnects iframe scanning', async function(assert) {
    const { win, doc } = await fixture();
    let scans = 0;
    win.vAPI.adCheck = () => { scans++; };
    win.vAPI.shutdown.exec();
    doc.body.append(doc.createElement('div'));
    await win.testFlushDOM();
    assert.strictEqual(scans, 0, 'Iframe scanning stops after shutdown');
});

async function fixture({ whitelisted = false, deferBootstrap = false } = {}) {
    const frame = document.createElement('iframe');
    frame.title = 'Parser test fixture';
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = `<!doctype html><body>
        <script src="./adn-parser-test-frame.js"
            data-whitelisted="${whitelisted}" data-defer-bootstrap="${deferBootstrap}"></script>
        <script src="../src/js/contentscript.js"></script>
        <script>window.testSetupScheduler();</script>
        <script src="../src/js/adn/textads.js"></script>
        <script src="../src/js/adn/parser.js"></script>`;
    document.querySelector('#qunit-fixture').append(frame);
    await loaded;
    const win = frame.contentWindow;
    if ( win.vAPI?.adParser === undefined ) {
        throw new Error('Parser was not initialized on frame load');
    }
    await win.testFlushDOM();
    return { win, doc: win.document };
}

async function adImage(win, doc) {
    const image = new win.Image();
    image.alt = 'Example ad';
    image.width = image.height = 100;
    image.src = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'
    );
    await image.decode();
    const link = doc.createElement('a');
    link.href = 'https://ads.example/landing';
    link.append(image);
    return { image, link };
}

function adVideo(doc, poster) {
    const video = doc.createElement('video');
    video.width = video.height = 100;
    video.title = 'Example video ad';
    if ( poster !== null ) { video.setAttribute('poster', poster); }
    const link = doc.createElement('a');
    link.href = 'https://ads.example/video';
    link.append(video);
    return { video, link };
}
