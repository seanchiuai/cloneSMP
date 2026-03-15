# Server Plugins

## SkinsRestorer — Required for custom hunter skins

Download the latest jar: https://hangar.papermc.io/SRTeam/SkinsRestorer

1. Download `SkinsRestorer.jar`
2. Drop it in this folder (`server/plugins/`)
3. Start/restart the Paper server once to generate its config
4. Skins are applied automatically by `scripts/set_skins.js` after bots join

### Skin assignments

| Bot | Skin |
|-----|------|
| SamAltman | ChatGPT skin |
| ElonMusk | Elon Musk skin |
| DarioAmodei | Claude AI skin |
| JensenHuang | Jensen Huang skin |

### Manual skin reset

If skins don't apply automatically, run manually:
```bash
RCON_PASS=clonessmp node scripts/set_skins.js
```

Or in-game as op:
```
/sr url SamAltman https://www.minecraftskins.com/skin/download/22755637/
/sr url ElonMusk https://skinsmc.s3.us-east-2.amazonaws.com/3ee42b505f824f55a548023c8c2561c1
/sr url DarioAmodei https://www.minecraftskins.com/skin/download/23191521/
/sr url JensenHuang https://namemc.com/texture/6c2a29744a6732c2.png
```
