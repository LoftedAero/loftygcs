# House conventions for this app's screens

`lofted-aero.css` and its DESIGN.md govern the *components* — what a button
looks like, which color means what. This is the layer above: how screens in
**this** app are put together.

Every rule here came out of a specific piece of feedback on a specific
screen, and the origin is kept with it. That is the point of the file — a
rule with its case attached can be argued with, and a rule that turns out to
be wrong can be found and removed. Nothing here is a guess about what might
look good.

Add to it when a review produces a preference that will apply again. If it
only applies to one screen, it is not a convention; leave it in a code
comment there.

---

## Space

### Fill the window

Screens are used full-screen. A layout that leaves two thirds of a 1920
window empty is wrong even if each part of it is well made.

> *"I don't like how tiles tend to be small and biased to one side of the
> screen, since this app will mostly be used full-screen."*

### Cap the column count, never the grid's width

The moment a `max-width` stops the tracks growing, the slack becomes side
padding — on the very screens the layout exists to fill. Cap how many
columns there are and let each keep its share of the width.

> *"Whatever you did created padding on standard 16:9 monitors too. Please
> revert that particular bit."*

### Three columns, not four

Betaflight's configurator authors one or two columns per tab and reaches
three only on its busiest screen. Four columns of settings is a row nobody
reads across.

---

## What a screen says when it has nothing to say

### A screen renders itself, never a description of itself

If there is no vehicle, draw the screen empty. Do not replace it with a card
explaining what would have been there. Both Fly and Overview did this and
both stopped.

> *"the description on the Overview page is a bit out of place… render this
> page's elements with some sort of null or placeholders when nothing is
> connected."*

### Empty is null, not zero

A dash, not a `0`. And a value with nothing behind it carries no status
color — a green `Disarmed` for an absent aircraft is a claim, not a
placeholder.

### Say it once, in the place it is already visible

If the empty state is legible from the screen itself, do not add a banner
saying so. Put whatever prompt is needed where the absence already shows.

> *"No need for the notice bar — the 'No vehicle' on the visualization is
> enough."*

---

## Alignment and rhythm

### A control sits beside its label, not at the far edge of the row

The system sheet's `.la-field` is `1fr auto`, which in a wide card puts
hundreds of pixels between a label and its value and stops the pair reading
as one thing. Scoped overrides pin the label column instead.

### One width for a column of controls

Every dropdown in a dialog is the same width, and the action row under them
matches. Let each size to its own longest option and the dialog grows a
ragged right-hand edge.

> *"make the drop-downs all the same width"* · *"Can you make the width of
> the drop-downs equal to the combined width of these buttons below?"*

Derive the two from **one** token rather than measuring one and copying the
number into the other, or a reworded label silently breaks the alignment.

### One dialog asking three questions keeps one shape

Where a dialog changes its fields by what it is being used for, everything
around the fields stays put: same card width, same rows, same box width
whatever a box holds. Sizing each variant to its own content is what pulls
them apart — the Connect dialog put a 170px host box above a 71px port box,
showed that same 71px box alone at the right of a 560px card for UDP, and
made the WebSocket URL a full-width stacked field. Three layouts for one
question with three answers.

> *"let's make sure the TCP, UDP, and websocket connect pop-ups are visually
> consistent with uniform padding, reasonable width, and matched-width input
> fields"*

A port number and a URL are both *the value*, so they get the same box. The
card is then sized to that column rather than left at the sheet's default,
or the narrowest variant is mostly empty.

### Sibling screens share a shape

Screens that do the same job in different modes get the same elements in the
same places, so switching between them moves nothing.

> *"make sure the placement and format of the elements on the mission,
> fence, and rally tabs are consistent"*

### Anything that grows goes last

A list that gains rows pushes everything under it down the column. Put it at
the bottom so nothing else moves.

> *"Put the shapes list (fence) and rally points list (rally) below the
> FILES interface on each"*

---

## Where a control lives

### Tools belong on the thing they act on

Drawing tools go on the map as a palette, not in a column of full-width text
buttons. The column is for what persists — vehicle actions, files, settings.

> *"Put the fence inclusion, exclusion, circle, etc. buttons on something
> that looks like the mission item graphical menu instead of buttons in the
> column"*

### An icon matches its siblings exactly

A control that joins an existing set takes that set's size, shape and
styling. A near-match reads as a different application.

> *"Make it the same size and shape and styling as the icon in the palette"*

### Replace a text field with the gesture that produces the value

Where a value can only come from somewhere else and cannot be checked by
reading it, the input box is the wrong control — a transposed digit in a
latitude still parses and boots a vehicle a hundred kilometers away looking
perfectly healthy. Point at the thing instead, and let the field become a
line that *shows* what was chosen.

> *"We need to be able to pick the flying field from the map rather than
> entering lat/long — that'd be much more intuitive."* · *"Replace the entire
> lat/long/whatever input field with the pick on map button. The user will
> probably never interact with those values directly."*

Keep the readout. Showing the current value was the one thing the box was
good at, and it is still needed.

### An action in a dropdown needs an entry of its own

A select entry that *opens something* — a file picker, a dialog — cannot
double as the entry showing what is currently chosen. Re-selecting an option
that is already selected fires no change event, so the action becomes
unreachable the moment it succeeds once. Keep "Select from file…" as a
separate row beside the current choice.

And put the control back before the picker opens: cancelling changes
nothing, so nothing re-renders, and the select is left displaying an action
it did not carry out.

> *"We do need to keep the Custom build … and Select from file … options in
> the drop-down in this new configuration so that the user can re-select."*

### A file dialog opens where the last one left off

One remembered folder, shared by every picker on a screen, persisted. Files
that get chosen together live together — a SITL build and its parameters are
in the same folder — so the second dialog should not start at the top of the
disk.

### Prefer a revealed control to a permanent one

A rarely-used action that belongs to an object opens from that object,
rather than occupying a row of its own forever.

> *"Can the 'from vehicle' button be something that appears when the user
> clicks on the home icon and not a dedicated one below it?"*

### A setting that stamps the next thing goes on that thing's header

Default altitude and altitude frame sit on the item list's title bar,
because that is what they act on.

---

## Words

### Use the vocabulary people already have

Mission Planner's terms beat invented ones for anyone arriving from it —
but only where they are true. Its Mandatory/Optional split was deliberately
not carried over: that distinction belongs to the airframe, not the screen,
and a label that is wrong half the time teaches people to stop reading
labels.

> *"Let's try 'Initial Setup'… like Mission Planner uses"* · *"This will be
> familiar to Mission Planner users."*

### No trailing “…” on a control, ever

Not on buttons, not on menu items, not on the option that opens a picker.
The old convention — an ellipsis meaning "this asks for something before it
acts" — is real and widely used, and it is not worth keeping here.

Two reasons. It **decays silently**: `HUD video…` was correct for as long as
it opened a dialog and became wrong the moment that dialog became a pane,
because nothing about the label changed. And "never" is a cheaper rule to
hold than "when the control asks for more", which needs a judgement at every
control and was already applied unevenly across eleven of them.

> *"I think we should remove the ..."* · *"Just never use them"*

**Progress text is not this.** `Writing…`, `Listing /APM…`, `Waiting for
telemetry…` keep theirs: the ellipsis is what separates a thing happening
from a thing finished, and `Writing` alone reads as done. So does elision in
the middle of a value — `[1, 2, 3, … 40]`.

### A label must not be ambiguous

If a word could mean two things in context, it is the wrong word, even when
it is the shortest one.

> *"'Vehicle' is an ambiguous label. What else fits there?"*

### Merge rows that never appear together

Two lines that are never both true are one line.

> *"Does 'Imagery ends at zoom n' and 'X of Y tiles missing' ever appear at
> the same time? If not, we can merge that row"*

### Trim the explanation once the mechanism is settled

Text written while working something out reads as debug output afterwards.
Go back and cut it.

> *"make that section less verbose now that we've worked out the details. It
> reads like debug messaging."*

Hints are short. A `.la-hint` says the one thing needed at the moment it is
read; the reasoning goes in a code comment, where it costs the reader
nothing.

---

## Structure

### Split a screen when it holds two sittings, not when it is long

The test is whether anyone would change something in both halves in one
session. Tuning splits into Attitude and Navigation because nobody tunes
gains and mission speeds at the same bench.

### Draw a two-axis set as a matrix

Roll/pitch/yaw against P/I/D is a grid. As three separate cards, the one
comparison anyone makes is a comparison across three headings.

### Group a long menu, using headings that are true

Fifteen rail items need groups. See the vocabulary rule above for which
headings.

---

## See also

- `CLAUDE.md` — the design-system rules that keep the shared stylesheet
  intact, and the traps dark mode exposed
- `docs/screen-review.md` — the per-screen approval gate these conventions
  are checked against
