for ( const [ id, url ] of [
    [ 'blocked', 'https://popup-preflight.invalid/' ],
    [ 'allowed', 'https://popup-preflight.invalid/allowed' ],
    [ 'blank', 'about:blank' ],
] ) {
    document.getElementById(id).addEventListener('click', ( ) => {
        const result = window.open(url, '_blank');
        document.getElementById('result').textContent = result === null
            ? 'Returned null. Check that no tab appeared and the positive controls work.'
            : 'A window was returned. Close the control tab manually.';
    });
}
