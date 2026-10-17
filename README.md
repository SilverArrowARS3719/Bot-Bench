# Bot Bench

Build a robot from real LEGO Technic parts in 3D, then drive it, or run your SPIKE Prime Python program on it, with real physics in an arena you design.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Use `npm run dev`: it turns on the cross-origin isolation that the Python runner needs.

## Pages and accounts

- `/` home page: Sign up, Log in, About us, and **Start building**.
- `/about.html` about us (placeholder text to replace with your own).
- `/account.html` sign up or log in: **Continue with Google**, or email + password; a new account confirms its email with a 6-digit code.
- `/studio.html` the studio. Only for signed-in people: anyone else is sent to sign up first and comes back after. Your initial at the top right has Log out.

All pages talk to accounts through `src/auth.js`. **No sign-in service is connected yet.** On the dev server a stand-in keeps accounts in your browser and shows the code on the page instead of emailing it, so the whole flow can be tried. A published build refuses to sign anyone in until a real service is connected there, so don't publish before that.

On a new computer you also need the part libraries: LDraw (about 230 MB download) and the LDCad snap data (about 2 MB).

```bash
curl -LO https://library.ldraw.org/library/updates/complete.zip
curl -LO https://library.ldraw.org/library/unofficial/ldrawunf.zip
unzip -q complete.zip -d public
unzip -q -n ldrawunf.zip -d public/ldraw
curl -L -o shadow.zip https://codeload.github.com/RolandMelkert/LDCadShadowLibrary/zip/refs/heads/main
unzip -q shadow.zip && mkdir -p public/ldcad && cp -R LDCadShadowLibrary-main/p LDCadShadowLibrary-main/parts public/ldcad/
npm run index-parts
```

With nothing built yet, the 3D view offers **Open the example robot** (`examples/spike-drive-base.ldr`; `node scripts/make-example.mjs` rebuilds it). Press **?** any time for every shortcut.

## Assistant

**Ask** (top right) or **/** opens it as a tab in the right-hand panel, next to Part (Build) or Drive and Code (Test), so it never covers the 3D view. Type what you want in plain words; it works offline, with no AI service or account:
- **Parts:** "add 3 hubs on top of 3 medium motors", "add 2 red 15 beams next to the hub", "put a castor ball under the hub". It asks when something is unclear (which motor? how long a beam?), offers buttons to answer, and adds missing parts first if you say yes.
- **Changing parts:** "make the hub black", "turn it", "turn the motor over", "delete the wheels", "select the sensors".
- **Testing:** "drive forward 30 cm then turn right", "go back 10 cm", "add a box in front of the robot", "play", "reset".
- **Other:** "how heavy is it?", "does it fit WRO?", "dark mode", "undo", "open the example".
- **Pictures and files:** attach, drop or paste them in the chat. It can't recognise what's in a picture (that would need an AI service), so it asks: a robot to copy (pinned in the corner of the 3D view while you build) or a mat for the arena. LEGO and 3D model files go straight onto the robot or into the arena.

It understands one step at a time, in set kinds of sentences; it can't follow a whole paragraph. Given a long description, it doesn't guess: it lists the parts you mentioned ("add 2 medium motors", "add 2 angled beams") as buttons to add them one by one. Several short sentences in one message run in order.

**Dark and light:** the sun/moon button (dark to start with). **[** and **]** (or the panel buttons at the top right) hide the side panels to give the 3D view the whole window.

### Smart assistant (Google Gemini, free tier)

With a Gemini API key the assistant understands normal sentences and looks at photos: send a picture of a robot and say "build this", and it works out the parts, asks what it can't tell (with buttons), and builds it using the same actions as the buttons and the offline assistant. Without a key, or when Google's free limit runs out, the offline assistant answers instead.

1. Get a free key at https://aistudio.google.com/apikey.
2. Copy `.env.example` to `.env.local` and paste the key after `GEMINI_API_KEY=`.
3. Restart `npm run dev`. The assistant says it's connected to Google Gemini.

The key stays on the server (`server/assistant-ai.js`); the page never sees it. The server only passes on text, pictures and the assistant's own actions, with fixed instructions, so it can't be used as a general chatbot, and each visitor gets at most 12 messages a minute and 300 a day. On Google's free tier, what people send (including photos) may be used by Google to improve its products; the assistant tells users this. The model is `gemini-3.8-flash` (set `GEMINI_MODEL` to change it).

### Publishing it

```bash
npm run build
GEMINI_API_KEY=your-key npm start
```

`npm start` (`server.mjs`) serves the built app from `dist/` with the headers the Python runner needs, plus the assistant. On a Node host such as Render or Railway, use `npm run build` as the build command and `npm start` as the start command, and set `GEMINI_API_KEY` in the host's environment settings, not in any file you upload. The built app includes the whole LDraw parts library (about 1 GB), so pick a host that allows that much.

## Build mode

- **Add a part:** click it in the list, move into the view, and click to put it down. It rests on whatever surface is under the cursor.
- **Auto-connect (on by default):** a part you move or place jumps onto the nearest pin, hole or axle under the cursor, turned the right way, at the right depth, without overlapping other parts. Hole against hole sits flush and friction pins are added for you. **C** or the toolbar button switches to **Manual**; hold **Alt** for one manual move.
- **Mine (your uploads):** upload your own files with **Upload your own**, or drop them on the left panel. LEGO models (.ldr, .mpd, .io) join your robot as a group that auto-connects, part files (.dat) become normal parts, 3D models (.stl, .glb, .obj) plus LEGO models go in the Test arena, and pictures become mats. They're kept in this browser.
- **Click together:** pins, axles, holes and studs snap together on their own, using the LDCad snap data. A green ring shows where a part will click in. Hold **Alt** to place without snapping.
- **Move:** drag a part to slide it over the floor; hold **Shift** to lift it straight up or down. The part glides after the cursor rather than jumping, a small nudge doesn't snap it anywhere, and it prefers connections at the height it's already at, so it doesn't drop into a hole below. The Move and Rotate handles are still there for exact moves.
- **Camera:** drag empty space to orbit, right-drag to pan, scroll to zoom towards the cursor.
- **Keys:**
  - **←↑↓→** nudge one grid step relative to the camera
  - **PgUp/PgDn** move up and down
  - **R** turns 90°; **Shift R** tips it over
  - **Del** deletes; **⌘/Ctrl D** duplicates; **⌘/Ctrl A** selects everything
  - **⌘/Ctrl Z** undoes
- **Select:** Shift-click selects several parts, and double-click selects everything connected to a part, such as a whole attachment.
- **Properties panel:** shows each part's real size, its mass and where that number comes from, and what it's attached to. "Not connected" means it isn't pinned.
- **Model panel:** shows total mass and size, with checks against the WRO (250 mm cube) and FLL (305 mm tall) start limits.
- **Outlines:** switches between the realistic look and instruction-book edges.
- **Selected part buttons:** Turn, Tip, Up, Down, Copy and Delete appear under the view, so you don't need the shortcuts. **Fit** brings the whole robot into view.

## Test mode

- **Play**, then drive:
  - **W/S** go forward and back; **A/D** turn on the spot at the **Turn speed** (30 % to start with, about 150°/s).
  - **W+A / W+D** drive a smooth curve: the inside wheel slows down instead of stopping.
  - Hold **Shift** to drive at 30 % for lining up.
  - Each extra motor (an arm, a claw) gets its own key pair: **Q/E**, **Z/C**, **R/F**, **T/G**. Arms hold their position when you let go.
- **Drive tab:** a card for every motor and sensor with live readings. Point at a card and its part glows in the 3D view. Set each one's port (A–F) to match your real robot, and each motor's job (left wheel, right wheel, arm) if the guess from the wheels is wrong. The app remembers your choices and driving settings.
- **Code tab, Blocks:** SPIKE-style word blocks (Movement, Motors, Sensors, Control, Light & sound, Operators, Variables) in the SPIKE app's colours. They run as SPIKE Python, and **Copy as Python** shows that code. The blocks start on your robot's own ports, and "move 20 cm" uses your robot's real wheel size and gearing. **turn right 90 degrees** is a gyro turn that slows down near the end; it lands within about 1° in the simulator.
- **Code tab, Python:** SPIKE Prime 3 Python, with the same `motor`, `motor_pair`, `color_sensor`, `distance_sensor`, `force_sensor`, `hub.motion_sensor` and `runloop` calls as the real hub. **Stop** works even inside `while True:` loops. Python (Pyodide) downloads from jsDelivr the first time you press Run.
- **Arena:** add boxes, walls, ramps and cans, or upload `.stl` (millimetres, Z-up), `.obj` and `.glb` models or LEGO models, each fixed or pushable with its own mass.
- **Mats:** upload a picture (or drop it on the 3D view) and it goes down at its real width; FLL/WRO mats are 2362 × 1143 mm. Every mat you upload stays in **My mats**, so you can switch between them.
- **Start position:** click the robot while stopped to move or turn where it starts.

## How real is it?

| What | How |
|---|---|
| Part sizes | LDraw geometry at 1 LDU = 0.4 mm. Tested against BrickLink sizes: EV3 parts, gears, wheels and the castor ball match to 0.2 mm, and the SPIKE hub to 1 mm. A 15-hole beam is 119.2 × 8 × 7.2 mm. |
| Plastic part mass | Solid volume × ABS density (1.05 g/cm³). Pins and axles use POM (1.41 g/cm³). Nine parts tested against BrickLink weights are all within 20 %. |
| Hubs, motors, sensors | BrickLink catalogue weights. Type your own measured grams into the properties panel to override them. |
| Motors | LEGO spec sheets: SPIKE Large is 175 rpm with 25 N·cm stall torque, Medium is 185 rpm with 18 N·cm, and EV3 and NXT are included. Torque falls linearly with speed, like a real DC motor. Speed ramps at 1000°/s², SPIKE's default. Stop modes are Brake, Hold and Coast. |
| Mechanisms | Built from the actual connections. Axles in axle holes and friction pins lock parts together, axles in round holes and smooth pins hinge, motor outputs turn, and meshing gears keep their ratio (module 1, so pitch radius = teeth ÷ 2 mm), including bevel gears. Worm gears turn their gear one tooth per worm turn and are self-locking: a gear can't turn a worm back. |
| Self-collision | The robot's parts push on each other, so an arm stops when it swings into the chassis. Parts that already touch in the build are left alone (an axle in its hole, a beam pinned flat against a motor), as are faces that just slide past each other across a hinge. |
| Collision shapes | Open parts such as frames and open-centre liftarms are made of boxes that keep the opening open; everything else, beams included, is one convex hull (a beam's 4.8 mm pin holes are filled in). Wheels are cylinders. |
| Ball castors | A real ball on a ball joint, so it rolls. |
| Sensors | Colour: reads the mat or obstacle under it and fades past about 8 mm. Distance: 40–2000 mm (SPIKE). Force: 0–10 N. Gyro: from the hub's real orientation. |
| Physics | Rapier at 240 steps/s. |

What the tests check:
- The sample drive base reaches 0.38 m/s against a theoretical 0.385 m/s at 75 % speed.
- `move_for_degrees(360)` drives 176 mm, one turn of a 56 mm wheel.
- An 8:24 gear train turns at exactly ⅓ speed, in the opposite direction.
- A worm turns a 24-tooth gear once every 24 turns, and holds it when nothing drives it.
- An arm holds its angle, and an arm swung into its own robot stops there.
- A 68-part robot runs its physics in about 3 ms per frame.

### Still approximate

- Parts that touch but aren't pinned are treated as glued to whatever they touch, as if you'd built them firmly.
- Rubber bands, pneumatics, differentials and turntables aren't simulated.
- Ordinary beams collide as solid bars, so something poking through a beam's pin hole won't fit through.
- Unpowered free-spinning parts that aren't wheels (turntables, for example) only turn if they're on a hinge.
- Colour sensor colours are matched to the 8 SPIKE colours by nearest RGB; real sensors vary with lighting.
- Pressing a force sensor is detected by distance (within its 4 mm travel), not by measured contact force.

## Tests

```bash
npm test
```

The 62 tests cover part sizes and masses against BrickLink, LDraw save and open, snap and connection detection, auto-connect, uploaded files, collision shapes, blocks turning into valid SPIKE Python, the assistant understanding requests, the Gemini relay (key kept server-side, input filtered, rate limits), and physics: speed, braking, steering, curves and slow driving, gyro, `move_for_degrees`, an arm, a gear train, a worm gear and its lock, self-collision, and sensors.
