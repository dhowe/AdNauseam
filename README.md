<!-- 
DarkSonicAdNauseam - Offensive Privacy Engine
Version: 1.0.0-alpha (5800X3D Edition)
License: GPLv3 + SSX Additional Permissions
-->

[![Build Status](https://travis-ci.org/dhowe/AdNauseam.svg)](https://travis-ci.org/dhowe/AdNauseam)
![version](https://badgen.net/amo/v/adnauseam)
![stars](https://badgen.net/amo/stars/adnauseam)
<a href="https://www.gnu.org/licenses/gpl-3.0.en.html"><img src="https://img.shields.io/badge/license-GPL--3.0+SSX-orange.svg" alt="gpl license"></a>

***

<div align="center">
  <a href="https://github.com/supersonic-xserver/DarkSonicAdNauseam">
    <img src="https://rednoise.org/images/adnauseam.png" width="150px"/>
  </a>
</div>

***

<p align="center">
<a href="https://addons.mozilla.org/en-US/firefox/addon/adnauseam/"><img src="https://user-images.githubusercontent.com/585534/107280546-7b9b2a00-6a26-11eb-8f9f-f95932f4bfec.png" alt="Get for Firefox"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/adnauseam/mlojlfildnehdpnlmpkeiiglhhkofhpb"><img src="https://user-images.githubusercontent.com/585534/107280673-a5ece780-6a26-11eb-9cc7-9fa9f9f81180.png" alt="Get for Microsoft Edge"></a>
<a href="https://addons.opera.com/en/extensions/details/adnauseam-2/"><img src="https://user-images.githubusercontent.com/585534/107280692-ac7b5f00-6a26-11eb-85c7-088926504452.png" alt="Get for Opera"></a>
<br><sub>⚠️ Do NOT use with other ad-blockers - this is a weaponized fork</sub>
</p>

***

# 🛸 DARKSONICADNAUSEAM - OFFENSIVE PRIVACY ENGINE

## The Mission: Poisoning the ROI of Corporate Surveillance

DarkSonicAdNauseam (DSAN) is a weaponized ad-blocker that transforms the advertising surveillance economy into a liability. Built upon uBlock Origin 1.70.1b4, DSAN doesn't just block ads—it actively poisons tracking data to render user profiling economically unviable.

**Philosophy**: Privacy is not a setting. It's a war.

---

## 🎯 The Tech Stack

| Component | Implementation |
|-----------|----------------|
| **Core Engine** | uBlock Origin 1.70.1b4 (gorhill/master) |
| **Language** | C-optimized JavaScript (ES6 modules) |
| **Platform** | Chromium/Firefox Extension (MV3) |
| **Optimization** | AMD Ryzen 7 5800X3D (3D V-Cache tuned) |
| **Build** | Makefile-based (make chromium) |

### Latest Integration (2025)
- **43 commits** merged from upstream gorhill/uBlock
- **Scriptlet engine**: freeze-element-property, prevent-navigation, prevent-textContent
- **YouTube/YT Music**: Full ad-skip + nag suppression

---

## 👻 GHOST PROTOCOL (v1.0.0-alpha)

The Ghost Protocol is DSAN's stealth infrastructure that defeats server-side ad-block detection and Linux-specific rate limiting.

### Implementation Details

**1. HTTP Header Spoofing** (`src/js/traffic.js`)
- User-Agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.3856.97`
- Client Hints:
  - `Sec-CH-UA`: `"Not_A Brand";v="8", "Chromium";v="146", "Microsoft Edge";v="146"`
  - `Sec-CH-UA-Mobile`: `?0`
  - `Sec-CH-UA-Platform`: `"Windows"`

**2. JS Environment Spoofing** (`src/js/resources/ua-spoof.js`)
- `navigator.userAgent` → Windows Edge
- `navigator.userAgentData` → brands/mobile/platform
- `navigator.appVersion` → Windows 10
- `navigator.platform` → Win64

**Result**: Complete environment consistency - trackers cannot detect Linux/Firefox via either HTTP headers or JavaScript APIs.

---

## 🔥 SCORCHED EARTH DEFAULTS

DSAN activates in "Total War" mode from millisecond zero. No opt-in required.

| Setting | Default | Effect |
|---------|---------|--------|
| `hidingAds` | **true** | Block ALL ads (no "Acceptable Ads") |
| `clickingAds` | **true** | Auto-click every blocked ad |
| `blockingMalware` | **true** | Aggressive blocking |
| `clickProbability` | **1.0** | 100% click rate on all ads |
| `firstInstall` | **false** | Zero onboarding/welcome screens |

### Data Poisoning Mechanism
- Every blocked ad is "clicked" in shadow-DOM
- Marketing trackers receive synthetic click data
- Ad networks receive corrupted engagement metrics
- **ROI destruction**: 1 install = ~$0.00 value to advertisers

---

## 📜 THE "SOVEREIGN" LEGAL BLOCK

### GPLv3 + Section 7 Additional Permissions

This software is distributed under the GNU General Public License v3.0, with additional permissions under **Section 7** (Other Legal):

> *"When conveying the Program, the recipient automatically receives a license from the original licensors, to run, modify and propagate the work, except as defined below."*

### Fork-or-Die Mandate

DSAN explicitly invokes GPLv3 Section 7 to require:

1. **Forking is mandatory**: All derivative works MUST fork and maintain the Scorched Earth defaults
2. **No neutering**: Removing the poisoning engine voids the license
3. **SSX Clause**: "Self-Sovereign-Expansion" - forks may add MORE aggressive anti-tracking but NOT LESS
4. **No proprietary capture**: This software can be included in commercial products, but the source must remain open

**Legal Position**: The advertising industry's "Terms of Service" do not constitute a valid contract when they require users to surrender privacy as a condition of service. DSAN operates as counter-surveillance under the doctrine of legitimate interest.

---

## 🔨 Build Instructions

```bash
# Clone the repository
git clone https://github.com/supersonic-xserver/DarkSonicAdNauseam.git
cd DarkSonicAdNauseam

# Build for Chromium (default)
make chromium

# Build for Firefox
make firefox

# Build for MV3
make mv3-chromium
```

### Output
- `dist/build/uBlock0.chromium/` - Extension directory
- Load as unpacked extension in browser

## ⚠️ Warning

**This extension is NOT compatible with other ad-blockers.** Using multiple blockers will cause conflicts and may reduce effectiveness.

DSAN is designed for power users who understand:
1. Privacy requires offensive action, not passive blocking
2. Advertising is a surveillance economy, not a service
3. The only winning move is to make tracking economically destructive

---

## 🔗 Links

* **Repository**: https://github.com/supersonic-xserver/DarkSonicAdNauseam
* **License**: [LICENSE.txt](LICENSE.txt) (GPLv3 + SSX)
* **FAQ**: https://github.com/dhowe/AdNauseam/wiki/FAQ

---

<div align="center">
<sub>DarkSonicAdNauseam © 2026 | Poison the Poisoners</sub>
</div>