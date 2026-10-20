# DG Room Markers

A web page for marking tiles in RuneScape Dungeoneering rooms and exporting them as
[Tile Markers](https://github.com/PrettyRS/tilemarkers) preset keys.

**Use it:** <https://quazih.github.io/dg-room-editor/>

- Browse rooms by theme, open one and click tiles to mark them, with a colour and label.
- Marks go to every copy of the room automatically: the other themes, matching door
  variants and duplicate rooms, turned to fit. A copy that differs in game (the map
  doesn't show objects or thin walls) can be made separate with one button.
- Turn the room to match how it looks in game. Marks are saved in the room template, so
  they land on the right tiles whatever the room's rotation on the floor.
- Click a doorway to make marks for that entry door only (needs the door-aware build of
  Tile Markers).
- Preview Surge, Escape and Dive from any tile.
- Export a `TM2…` key for one room, a theme or everything, and import keys back.

Marks are kept in your browser's local storage.

## Development

```sh
npm install
npm run build     # bundles src/ into docs/, which GitHub Pages serves
npm test          # checks every room's copies line up
npm run test:codec -- <lua 5.4 binary> <tilemarkers repo>   # checks the codec against the plugin's Lua codec
```

`public/` holds the room list and image sheets. `tools/build-data.cjs` regenerates them
from [mejrs' RS3 map tiles](https://github.com/mejrs/layers_rs3):

```sh
node tools/build-data.cjs <dir with z3/ and nomove2/ tiles> public
node tools/build-links.mjs public/rooms.json   # finds which rooms are copies of each other
```

Map images are from mejrs/layers_rs3 and © Jagex. This project is not affiliated with Jagex.
