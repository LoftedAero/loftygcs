# UI conventions

`src/styles/lofted-aero.css` governs the components: what a button looks
like and which color means what. This document is the layer above it: how
screens in this app are put together, and which classes and tokens implement
each convention. The general principles behind them are in
[ux-rules.md](ux-rules.md).

Add a convention here when a review produces a preference that will apply
again. If it applies to one screen only, leave it in a code comment on that
screen.

## Space

### Fill the window

Screens are used full-screen. A layout that leaves two thirds of a 1920px
window empty is wrong even if each part of it is well made.

### Cap the column count, never the grid's width

A `max-width` stops the tracks growing and turns the slack into side padding,
on exactly the screens the layout exists to fill. Cap how many columns there
are and let each keep its share of the width.

### Three columns, not four

Four columns of settings make a row nobody reads across. Betaflight's
configurator uses one or two columns per tab and reaches three only on its
busiest screen.

## Empty and disconnected states

### The navigation offers what can be done now

With nothing connected, a screen that needs a live aircraft leaves the rail,
as in QGroundControl, Mission Planner and Betaflight. A screen whose subject
is a document (a mission, a parameter file, a firmware image) stays; one
whose subject is live vehicle state goes. Someone on a screen that disappears
is taken to another. A screen kept for offline use makes clear what it is
working on: a parameter file opened offline never offers to write itself to
an aircraft, even after one connects.

### A screen renders itself, never a description of itself

If a screen cannot be used yet, draw it and disable its controls. A card
describing the screen can hide the control that fixes the state: replacing
the OSD workspace while `OSD_TYPE` is 0 would also remove the Display card
where `OSD_TYPE` is set. When changing an empty state, check what it takes
away as well as what it says.

### A panel with nothing to say is not drawn, but absence is a reading

With no vehicle, a vehicle panel draws nothing at all, not a greyed or zeroed
placeholder; the app bar's status row renders nothing without a connection.
Once a vehicle is connected, the set of readings is fixed: a flight
controller with no GPS still shows "No GPS", because that decides whether the
position modes can be flown, and a fixed set keeps the row one shape on every
aircraft.

Never draw a value the vehicle did not give. `0.0V` means both "no monitor
fitted" and "a dead pack", so the slot stays and the number becomes a dash. A
battery charge estimate of -1 draws an empty cell, not a flat one.

### Color a reading with the vehicle's thresholds, or not at all

A threshold invented here would present this app's opinion as the
aircraft's. The battery is colored from the vehicle's `BATT_LOW_VOLT` and
`BATT_CRT_VOLT`; GPS turns amber below a 3D fix, where ArduPilot itself
refuses Loiter, Auto and RTL. With no threshold configured, show no color. A
level (a battery's fill, lit signal bars) needs no threshold, since it only
pictures the number beside it.

### Empty is null, not zero

Show a dash, not `0`. A value with nothing behind it carries no status color:
a green "Disarmed" for an absent aircraft is a claim, not a placeholder.

### Say it once, where it is already visible

If the empty state is legible from the screen itself, do not add a banner
saying so. Put any prompt where the absence already shows.

### A screen is controls, not prose

See [ux-rules.md](ux-rules.md#controls-not-prose). The only exceptions here
are a `.la-hint` saying why a control is disabled or a value was refused, and
the shaded status line on Firmware, which narrates a flash step by step.

## Actions and writes

### A card's actions live on its title row

Buttons go on the title row, right-aligned, and the body holds only
settings, so actions are always in the same place and dropdowns are not
broken up by buttons of another width. Settings that belong together sit in
one row, each label above its control. The actions column on full-height
screens is different: it is scanned from the top, so it runs vehicle actions,
then files, then settings.

### A write answers inside the control that made it

"Saved" appears in the control that was just changed, not on the card, so
there is no doubt which field it means. While it shows, the control's text
area shortens and a long value is cut with a fade; the word never paints over
the value. The control itself never changes size, so give it its column's
width rather than its content's.

### A reboot is not a disconnect

The app asks for the restart and reconnects on its own, so it returns to the
screen that asked. The placeholder shown meanwhile says what is happening
rather than asking for a vehicle.

### Red is status, except for destructive actions

Green and red are status colors, never actions. The one exception is a
control whose purpose is destructive, such as Stop all on the motor test and
the confirm buttons on MAVFTP and the joystick.

### A setting that gates other settings writes itself

Other edits stage until Write. A parameter that decides whether other
parameters exist is written immediately, followed by a background parameter
refresh, because until it is written the screen has nothing to show. It never
writes on a keystroke (a dropdown commits on change, a number field on Enter
or blur), and a failed write falls back to a staged edit.

### One prompt per thing to fix

A control that carries a setting, with a hint saying what "off" means, is
already the prompt. Do not add an emphasized panel offering the same change.

## Alignment and rhythm

### A control sits beside its label

The design system's `.la-field` is `1fr auto`, which in a wide card puts
hundreds of pixels between a label and its value. Scoped overrides in
`app.css` pin the label column instead, so the pair reads as one thing and
the controls in a card line up.

### One width for a column of controls

Every dropdown in a dialog is the same width, and the action row under them
matches. Derive both from one token rather than copying a measured number,
or a reworded label silently breaks the alignment.

The same applies to an actions column that carries settings:
`.app-col--fields` gives every control there `--app-col-control-w`, and
labels are shortened to fit beside it rather than wrapping.

### Nothing in a bar absorbs the window's slack

An element sized `flex: 1 1 auto` in a bar turns spare width into a short
string in a very long box. Give a bar's contents their own size, and make
room by dropping whole items at a breakpoint rather than squeezing them: a
clipped `15.9V 24.1A 61%` is a wrong reading. Set each breakpoint against the
longest string a real vehicle produces.

### A control never moves because a reading changed

Anchor a bar's fixed groups to its edges and let only the live part float
between them. The app bar has three bands: the app on the left, vehicle
status in the middle, the link on the right. It is a three-track grid
(`1fr auto 1fr`), not a row with two spacers, which would center the status
between unequal groups rather than on the window. Each reading gets a slot as
wide as its longest string, noted beside the width in the CSS, so a changing
value never pushes its neighbors.

### One width for a row of gauges

Repeated readings in a row share one slot width, so their icons land on a
constant pitch and the strip reads as a set. Make the equal slot fit by
cutting what the row does not need rather than widening it: where an icon
already pictures the level, secondary numbers such as pack current or packet
rate go in the tooltip.

### A filled shape is read by its edge

When an item in a row has a background (a pill, chip or badge), the eye
measures spacing from its edge, not from its text. Measure gaps the same way.

### One dialog with variants keeps one shape

Where a dialog changes its fields by mode (the Connect dialog for TCP, UDP
and WebSocket), everything around the fields stays put: same card width, same
rows, same box width whatever the box holds. A port number and a URL are both
"the value" and get the same box. Size the card to that column rather than
leaving it at the design system's default.

### A panel is framed one way, in one place

A hairline border, the small radius and the surface background together make
a panel. The actions column is `.app-col-shell` around `.app-col`: the shell
owns the frame, background and scrolling; the inner column owns the padding
and spacing between groups. Use these classes instead of repeating the frame
styles. If a new kind of surface genuinely needs its own frame, add its
selector to `src/styles/panel-frame.test.ts`, which lists every selector
allowed to draw the frame and fails on a bare `.app-col` without a shell.

### A screen with a column fills the window; only its panes scroll

The screen takes the window's height and its panes scroll inside their own
frames, so the actions column stays beside what it acts on without sticky
positioning. Set `fills: true` on the tab: the content area is a grid with
`align-items: start`, where `flex: 1` on a screen's root does nothing, so
without `fills` the page scrolls instead.

### A column is as tall as the pane beside it

Place the actions column in the pane's grid row, so the two framed panels
start and end on the same lines. A pane's toolbar and caption (search, path
bar, row count) go in that pane's track; only something that changes the
whole screen, like the Inspector's view switcher, spans both tracks.

The gap between pane and column is always `--app-col-gap`.

### A panel inside a panel is one panel

Two surfaces of the same color, one inset inside the other, read as one box
with a line through it. A screen either is a card or contains framed panels,
never both. MAVFTP is the pattern: a card while there is nothing to show, its
own full-height layout once there is.

### Sibling screens share a shape

Screens that do the same job in different modes (the mission, fence and
rally plans) put the same elements in the same places, so switching between
them moves nothing.

### A card keeps its name and place on every airframe

A card that does one job has the same title and position on every vehicle.
Only a card with no counterpart, such as the VTOL motor gains on a quadplane,
appears or disappears. Fit airframe differences inside the card: a
quadplane's VTOL rate filters are rows in the one Rate filters card.

### The same card twice is one height

Two cards that are instances of the same thing (the first and second harmonic
notch, fixed-wing and VTOL rate filters) sit side by side in one grid row so
they share a height. Stacked columns suit cards that are not twins; balance
them against measured heights.

### Anything that grows goes last

A list that gains rows goes at the bottom of its column, so nothing under it
moves.

## Where a control lives

### Tools belong on the thing they act on

Drawing tools go on the map as a palette, not in the column as full-width text
buttons. The column is for what persists: vehicle actions, files and
settings.

### Judge an icon at the size it is drawn

An icon that reads well at 96px can be illegible at the 16 to 20px the app
bar uses. Check it at its real size. A legible unconventional icon (the GPS
globe) beats an illegible conventional one.

### An icon matches its siblings exactly

A control joining an existing set takes that set's size, shape and styling.
A near-match looks like a different application.

### Replace a text field with the gesture that produces the value

Where a value comes from somewhere else and cannot be checked by reading it,
a text box is the wrong control: a transposed digit in a latitude still
parses and puts the vehicle a hundred kilometers away. Let the user point at
the thing (a location on a map), and show the chosen value as a readout.

### An action in a dropdown needs its own entry

A select entry that opens something (a file picker, a dialog) cannot also be
the entry showing the current choice. Re-selecting an already selected option
fires no change event, so the action becomes unreachable once it has
succeeded. Keep "Select from file" as a separate entry beside the current
choice, and reset the control before the picker opens, since a canceled
picker triggers no re-render.

### A file dialog opens where the last one left off

Use one remembered folder, shared by every picker on a screen and persisted.
Files chosen together usually live together.

### Prefer a revealed control to a permanent one

A rarely used action that belongs to an object opens from that object rather
than occupying a row of its own.

### Work the screen starts by itself may not prompt

A background probe uses only what it already has (such as a serial port
already granted) and gives up otherwise; only an action the user pressed may
raise a chooser. Where the answer can be determined, don't ask: the desktop
app picks the bootloader port itself when exactly one new port appears. Show
that background work is running, or its result appearing a second later looks
like the app changing its mind.

### Order questions so each answer narrows the next

Put first the question whose answer constrains the rest. On Firmware the
board is detected first, and the vehicle tiles, release list and file picker
are then limited to what that board can take; a vehicle with no build for it
is disabled rather than hidden. A question the app has answered outright is
not asked, but the readout of the answer stays visible.

### A setting that applies to the next item goes on that item's header

Default altitude and altitude frame sit on the mission item list's title bar,
because they apply to the next item placed.

## Words

### Use the vocabulary people already have

Mission Planner's terms beat invented ones for users coming from it, but only
where they are accurate. Its Mandatory/Optional split is not used here: that
distinction depends on the airframe, not the screen, and a label that is
wrong half the time teaches people to stop reading labels.

### No trailing "…" on a control

Not on buttons, menu items, or the option that opens a picker. An ellipsis
meaning "asks for more first" goes stale silently when behavior changes, and
"never" is easier to apply consistently. Progress text (`Writing…`) keeps it,
as does elision inside a value (`[1, 2, 3, … 40]`).

### An error names what the user did

Say which thing failed, in the terms the user entered, and what state it is
in: "Nothing is listening at 127.0.0.1:5760", not `Error invoking remote
method 'link:open': Error: connect ECONNREFUSED 127.0.0.1:5760`. Match on the
error code, which is stable, rather than the message text, which is not.
Where there is no code, repeat the message plainly instead of guessing at a
cause.

Canceling is not failing. Closing a picker, dismissing a prompt or choosing
not to connect never produces an error state.

### Work that is not about one screen is reported on the app bar

While a parameter download runs, every curated screen shows an incomplete
vehicle, so its progress goes on the app bar, as in QGroundControl. The
indicator sits outside the layout flow so it moves nothing, sweeps until the
first fraction arrives rather than sitting at 0%, and is blue rather than
green, because progress is activity, not a verdict.

### A value that cannot fit its box is shortened, not clipped

Where a control is too narrow for ArduPilot's text, show a compact form: a
bitmask as "2 selected" (or "none"), and a long option by a short name that
keeps what distinguishes it ("Yes(minimum PWM when disarmed)" becomes "Yes,
min PWM"). The full text stays in the hover text. Short names live in one
table keyed by ArduPilot's text (`option-names.ts`), because the same number
means different things on different vehicles; a card opts in with `compact`.

### Merge rows that never appear together

Two lines that are never both shown are one line.

### Don't explain what the app is about to do

See [ux-rules.md](ux-rules.md#dont-explain-what-the-app-is-about-to-do);
prefer an empty slot to a filled one. Reassurance ("this is recoverable",
"nothing is erased") goes in the confirm dialog for that action, where it is
read. That applies to safety text most of all, because standing warnings are
the ones people learn to skip, and standing text goes stale when behavior
changes. Domain knowledge is different: "set them from a real flight log, not
a bench reading" changes the number someone types, so it stays.

### Keep hints short

Once a mechanism is settled, cut the text written while working it out. A
`.la-hint` says the one thing needed at the moment it is read; the reasoning
goes in a code comment.

## Structure

### Split a screen by sitting, not by length

The test is whether anyone would change something in both halves in one
session. Filters is its own screen ahead of Tuning because notches are set
once per airframe from a batch-sampler log before any gain is touched, while
gains are revisited. Tuning's attitude and navigation halves share one screen
as two columns because they are tuned in the same sitting.

### Draw a two-axis set as a matrix

Roll, pitch and yaw against P, I and D is a grid. As three separate cards, the
one comparison anyone makes spans three headings.

### Group a long menu with accurate headings

The Setup rail is grouped (Initial Setup, Config/Tuning, Data). See the
vocabulary rule above for how headings are chosen.

### A table is one treatment; only its columns are its own

Every settings table uses `.app-table` in `app.css`, which supplies the
frame, header band, row rule, row metrics and monospace identifier column. A
table declares only its `grid-template-columns`. The header reuses
`.la-card__subtitle`'s type settings rather than defining its own.

## Compact mode

For a window too small for the desktop layout, such as a handheld ground
station at 732×412. The mechanisms are in
[architecture.md](architecture.md#compact-setup).

### A screen keeps everything and rearranges it

Compact mode never drops a setting or an action. It moves what does not fit
behind one tap: a drawer, an expanding row, a row that scrolls sideways.

### Navigation lives in the app bar

The content area is too short to give a row to a selector. The mode switch's
Setup button names the screen and opens the list, at one width for every name.

### The column is a side panel; Write stays in view

Every screen's column opens the same way: one square button with a side-panel
icon at the top-right of the pane, blue while open, and a floating panel
hanging under the row that holds it. That row stays usable: the button that
opened the panel closes it, and Write stays beside it. Anything else floating
in that row over the panel's side (Plan's map controls) steps aside while the
panel is open. A screen never has two different buttons for its panels on one side. Controls
in the same row as the button are its height, so the row reads as one set.

### A list of things on a map rises from below

Plan's items open as a sheet from the bottom, under an Items handle that rides
on its top edge and closes it again. The route stays in view above the list,
and a wide sheet suits the altitude profile and an item's fields laid out
across. The side panel and the sheet are one at a time. Write sits beside the button with its
count, because a staged edit nobody can see is an edit nobody writes. The
column's own Write is hidden, so there is still one.

### A wide table shows what is watched and opens the rest

A row keeps the columns read at a glance (a servo's function and position) and
a chevron opens the ones set once (its travel) in a row beneath. Columns are
never squeezed until their controls overlap.

### A finger nudges with arrows

Where a desktop moves a selection with the arrow keys, a touch screen gets a
pad of arrow buttons at touch size, stepping once per tap and repeating while
held. The number boxes stay for an exact value.

### A set of pictures is one scrolling row

Thumbnails side by side, with the last one cut off so the row reads as
scrollable, instead of full-size pictures stacked down the page.

## See also

- [architecture.md](architecture.md): the design-system rules for
  `lofted-aero.css` and `app.css`, including dark mode
- [screen-review.md](screen-review.md): the checklist these conventions are
  checked against
