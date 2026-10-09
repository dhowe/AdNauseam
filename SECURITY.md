# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| > 3.11.x  | :white_check_mark: |
| < 3.10.x| :x:                |

## Release intervals

AdNauseam is based on uBlock Origin, we do merges from uBlock Origin code as much as we can, but since we need to make sure that AdNauseam doesn't break when uBlock Origin changes their code structure or changes some specific implementation, we tend to lag behind a bit, usually 1 or 2 versions. As of 2023 new release is expected 1 or 2 months. 

( e.g. 25.02.2022 current release 3.16.2 has uBlock Origin 1.45.0 version merged, when the most version as of that date is 1.47.2 )

## Reporting vulnerabilities

Vulnerabilities can be reported in the [issues page](https://github.com/dhowe/AdNauseam/issues). Make sure the issues are AdNauseam-specific. If the particular version of uBlock Origin we are currently merged to is reported to have a vulnerability, we will update as fast as we can.

## External libraries

All external libraries used by AdNauseam can be found on [src/lib](https://github.com/dhowe/AdNauseam/tree/master/src/lib) folder. 

| Library               | Version |
| ----------            | ------- |
| jQuery.js             | v3.4.1  | 
| jquery.mousewheel.js  | v3.1.12 |
| JSZip.js              | v3.1.3  |
| d3.js                 | v7.9.0  |
| packery.js            | -       |
| punycode.js           | v1.3.2  |
| regexanalyzer         | vv1.1.0 |
| QUnit                 | v2.0.2  |
| hsluv                 | v0.1.0  |
| css-tree.js           | v2.2.1  |
| CodeMirror            | v6.0.1  |
