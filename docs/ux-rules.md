# Lofted Aero UX rules

The design system (`lofted-aero.css` and its DESIGN.md) says what a button, a
card and a color *are*. These rules say how a screen should *behave and read*
— the preferences that turned first-pass screens into ones that were
approved, collected from page-by-page reviews of Loft GCS and written so they
apply to any Lofted Aero app.

Each rule is a short statement, what to do about it, and the words that
produced it. The quotes are the evidence: a rule that cannot point at one is
a guess, and a rule that turns out wrong can be found and argued with.

**How to use it.** Build the screen, then run the checklist below against it
*before* showing it — in the running app, at more than one window size, in
every configuration the screen has. Most first-pass misses are on the
checklist; the rules after it say why.

This file is app-agnostic on purpose. Keep app-specific mechanisms (class
names, component names, a particular screen's history) in that app's own
conventions document; keep this one portable, and copy it between apps the
way the shared stylesheet is copied.

---

## The first-pass checklist

Words
- [ ] No sentence on the screen explains what a control does, how the app
      works, or what will happen next. Labels only.
- [ ] Every remaining hint says why something is disabled or refused, and is
      one short line.
- [ ] No "…" on any button, menu item or option. (Progress text keeps it.)
- [ ] Every label is unambiguous in context, and uses the vocabulary of the
      tools the user already knows.
- [ ] No value is clipped in its box: shorten it, or count it ("2 selected").
- [ ] Empty values read "-", not "0", "None yet" or a sentence.

Stability
- [ ] No card, tile, row or dialog changes height when a value, state or
      selection changes. Optional content is drawn disabled, not added.
- [ ] Nothing the user reaches for moves when something else changes.
- [ ] Every step of a wizard puts its picture and buttons in the same place —
      measured, not eyeballed.
- [ ] Transient confirmations appear in a slot that already exists, and go
      away by themselves.

Consistency
- [ ] Every control in a column (and every button in its row) is one width.
- [ ] Buttons of the same role are the same size everywhere on the screen.
- [ ] The same card has the same name and place in every configuration.
- [ ] A second instance of something (battery, screen, port) gets the first
      one's whole set, not a subset.
- [ ] Cards side by side are the same height; columns end on the same line.
- [ ] This screen does the same thing the same way as its siblings (actions,
      writes, tables, dialogs, empty states).

Layout
- [ ] The screen fills a full-screen window; nothing hugs one side.
- [ ] Nothing scrolls at common full-screen sizes, in every configuration.
      Measured, not assumed.
- [ ] Only panes scroll; the actions column stays in view.
- [ ] No whitespace that a side-by-side arrangement would remove.

Controls
- [ ] Each card's actions are on its title row. One primary action per
      region.
- [ ] Rarely used settings are behind a dialog, not rows on the page.
- [ ] Anything the app can work out, it works out — and asks only on failure.
- [ ] A wizard that succeeds closes itself and leaves a brief word behind.
- [ ] A control that enables another is right next to it.

Process
- [ ] Nothing was built that was not asked for.
- [ ] Every change was checked in the running app, not reasoned about.

---

## 1. Words

### Controls, not prose

A screen is a set of controls with their labels. It does not narrate what a
control is for, what a procedure involves, or why a setting matters — that
goes in a code comment, where it costs the reader nothing. If a control needs
a sentence, its label is wrong.

Descriptions accumulate one reasonable-looking sentence at a time, and the
result is a screen people learn to skim.

> *"Getting a little irritated at how frequently random text and descriptions
> are being placed throughout the app."*
> *"I've noticed you have a habit of inserting explanations or verbosity that
> might not be needed."*

### Never explain what the app is about to do

If the app can do something, it should do it silently; if it cannot, the
question it asks at that moment explains itself. The test for any line: what
does the reader do differently for having read it, **right now**? No answer
means delete it.

> *"…is technically true — but the user doesn't have to know this in
> advance."*

Two narrow exceptions. A line saying why a control is **disabled** or why a
value was **refused**. And a status line narrating a long operation someone
is watching (a firmware flash) — *"A rare exception to my minimum-verbosity
rule."* Advice about *how* to choose a value ("set it from a flight log, not a
bench reading") is still a standing instruction, and people learn to skip
those; it goes in the comment beside the field.

### Short, plain, and in the user's words

Messages say the one thing needed, in a sentence a person would say. Match the
wording of the tools the user comes from where it is true.

> *"Just make it 'The board stopped accepting DFU commands. Please reboot and
> reconnect it, still in DFU mode.'"*
> *"Shorten the text to: 'Could not detect board, please retry.'"*
> *"Change the text to 'No heartbeat received', to match Mission Planner."*
> *"Ok this is way too verbose."*

When a mechanism is finished being worked out, go back and cut the text that
was written while working it out — it reads as debug output afterwards.

> *"make that section less verbose now that we've worked out the details. It
> reads like debug messaging."*

### Action labels say what happens, and to what

A button names its action and its direction: *Read from vehicle*, *Write to
vehicle*, *Open from file*, *Save to file*. A dialog's buttons are the
answers, not a restatement of the question: *Takeoff / Waypoint / Cancel*.

> *"'Read vehicle' to 'Read from vehicle'… 'Open file...' to 'Open from
> file'"*
> *"Remove the explainer in the takeoff prompt pop-up — just the buttons are
> fine."*

A label is the action, not a readout. A value the screen already shows
elsewhere does not ride on the button that acts on it; the button says *Next*
and is disabled until it can be pressed.

> *"I don't really like the 'Channel x - next' label the button gets."*

### No trailing "…", ever

Not on buttons, menu items, or the option that opens a picker. Progress text
(*Writing…*, *Waiting for telemetry…*) keeps it — there the ellipsis is what
separates happening from done.

> *"Just never use them."*

### A label must not be ambiguous

If a word could mean two things in context it is the wrong word, even when it
is the shortest.

> *"'Vehicle' is an ambiguous label. What else fits there?"*

### Use the words people already have

Borrow the established tool's terms where they are accurate; a label that is
wrong half the time teaches people to stop reading labels. Spell a unit out
where its symbol is hard to see (*degrees*, not °). Use the source system's
exact names where users will look them up elsewhere.

> *"I'd like the options under 'More' to match the exact naming of the mission
> items ArduPilot uses rather than our existing human-friendly translations."*
> *"The degrees symbol is hard to see — just spell out degrees."*

### A value that cannot fit its box is shortened or counted, never clipped

A multi-select shows *"2 selected"* (or *"none"*); a sentence-length option
shows a short name that keeps what distinguishes it. The full text is the
hover text.

> *"For options or drop-down fields, adopt the 'n selected' or shortened
> string approach for clarity."*

### Empty is a dash

A missing value is "-", not 0 (which is a reading) and not a sentence.

> *"Replace 'None yet' with '-'."*

### Consistent punctuation and case

Similar messages end the same way; decide once whether they carry a period.
American English throughout.

> *"check to see if a period makes sense based on our other similar messages"*

---

## 2. Stability — nothing moves

### A card is one height whatever it holds

No tile, dialog or table changes height when a value is entered, a state
changes or a selection is made. Optional content is *drawn and disabled*, not
added; a field that does not apply yet is greyed, not hidden; a message
appears in a slot that already exists.

> *"Keep the height from changing based on inputs. To do that, we can't have
> text and fields that change when the user does something."*
> *"Always show the VTOL frame class and types, just disabled when not needed.
> That way the height of the tiles becomes fixed."*
> *"Can you format the various optional items… such that the box never changes
> height?"*

### Nothing you reach for moves

Anchor fixed controls to edges and let only live content float between them.
Give each changing reading a slot as wide as its longest value.

> *"I'd prefer the connect UI remain on the right side of the screen in a
> manner that doesn't shift around if the new elements that appear change
> size. For that matter, try and keep that from happening in general."*

### The steps of a flow share one layout

Moving from one step of a wizard to the next changes the words and the
picture, never where they sit. Every step has the same lines in the same
places, each one line long; a warning replaces a line rather than adding
one; the buttons are one fixed width however their labels change. Check it
by measuring the picture's position on consecutive steps — the cause is
rarely the thing that seems to move it (a lead line wrapping to two looked
exactly like a button appearing).

> *"The graphic moves when the 'step x of y' appears. I think we can just
> delete that text."*
> *"now the graphic moves up when the back button appears, please find a way
> to avoid that"*
> *"the two buttons on the page are different sizes"*

### Confirmations are brief and in place

"Saved", "Level set", "Stop sent" appear beside what they confirm — in the
field, or on the card's title row — and disappear after a few seconds. They
never add a row.

> *"Make the 'Level set' (and other related text) appear in the header to the
> left of the set level button, and have it go away after a few seconds."*
> *"The 'Stop sent to all motors' should disappear after a short time."*

### Anything that grows goes last

A list that gains rows goes at the bottom, so nothing under it moves.

> *"Now as items are added, they won't reposition other items on the menu as
> they grow."*

### Sets that change with a selection keep their count

A gallery of options keeps the same number of items when a related setting
changes, and never shows an item inconsistent with the selection.

> *"I am trying to avoid… the amount of images drastically changing when the
> user navigates drop-down options… [and] images appearing that are not
> consistent with the selection."*

### Default sizes fit their content

A pane opens at a size that shows what is in it; an empty one opens small and
grows when it gets content.

> *"Make sure the default size of the empty mission item table is at least big
> enough for all the text inside it."*

---

## 3. Consistency

### One width per column of controls; buttons match their fields

Every dropdown and input in a column is the same width, and a button beside
them takes that width too. Derive them from one token.

> *"make the drop-downs all the same width"*
> *"Make the calculate button the same width as the input fields."*
> *"Please enforce consistent field widths."*

### Same role, same size

Buttons doing the same kind of job on one screen are the same size; a small
button beside regular ones reads as a different kind of thing.

> *"Make the 'Stop all' button the same size as the 'Disable' button."*
> *"Make the reboot button the same size as the other buttons."*
> *"just make the 'Remove button' larger to be consistent with other button
> sizing"*

### The same card, the same place, in every configuration

A card that does one job keeps its title and its position whatever variant of
the screen is showing. Only a card with no counterpart appears or goes.
Balance a layout inside the cards, not by renaming or reshuffling them.

> *"I don't like the idea of renaming and rearranging tiles that have
> essentially the same function between configurations."*

### Matched heights

Cards in a row are one height; stacked columns end on the same line (the last
card takes the slack); two instances of the same card are identical in size.

> *"please make the Panels column and the Screen layout tab the same height"*
> *"I don't like that the first and second harmonic notch tiles are different
> heights."*
> *"Make sure either window has a mechanism to get padded on the bottom so
> that their heights always match."*

### A second instance gets the whole set

When the thing being configured comes in instances — a second battery, a
fourth OSD screen, another serial port — each instance gets the same settings
in the same cards, with a switch to choose which one is showing. Not a short
list of "the important ones" for the extras: a subset hides settings that
exist, and answers a question nobody asked about which ones matter.

> *"Does the second battery monitor have the same suite of options as the
> first, or a smaller subset?"* — asked of a first pass that gave it six rows
> of fourteen; resolved as a Battery 1 / Battery 2 switch over identical cards.

### Sibling screens and patterns share a shape

When a pattern exists on one screen — a write control, a table, an empty
state, a dialog, a column — every other screen does it the same way. When
changing one instance, find the others.

> *"Make sure the placement and format of the elements on the mission, fence,
> and rally tabs are consistent."*
> *"Check to see if this pattern repeats anywhere else."*
> *"We have tables for various purposes in a few of our setup pages. I want to
> make sure these tables and their fonts, labels, and general styles are
> consistent."*

### Alignment is exact

Headers sit centered over their columns; inputs in a row share a baseline even
when some carry sub-labels; controls line up with the labels above them; a
button array starts from the same edge as the fields above it. Tabs in a strip
are evenly distributed.

> *"I don't like that the parameters input boxes are lower than the ones to the
> left of them because of their sub-labels."*
> *"I'd like to see how it looks to have the other titles centered above their
> respective fields."*
> *"left-justify the A/B/C/D buttons"*
> *"Please evenly distribute the… menu tabs."*

### Fonts and text styles are one set

Same size, weight and color for the same role across a screen and the app; a
sub-label (identifier, unit) is one consistent quieter style.

> *"These fonts look inconsistent, are they?"*
> *"Please unify the font and styling between the 'Waiting for telemetry…' in
> both places."*

### Icons match their set

A control joining an existing set of icons takes the set's size, shape and
style exactly. Judge an icon at the size it is drawn.

> *"Make it the same size and shape and styling as the icon in the palette."*

---

## 4. Layout

### Fill the window

Screens are used full-screen: fill the width with meaningful structure, never
leave content hugging one side. On ultrawide screens cap the number of
columns, not the page width — side padding on an ordinary monitor is the same
failure. A frame should still be only as wide as its content needs.

> *"I don't like how tiles tend to be small and biased to one side of the
> screen, since this app will mostly be used full-screen."*
> *"Ultrawides should cap."*
> *"Whatever you did created padding on standard 16:9 monitors too."*

### No scrolling

A setup screen fits a full-screen window without scrolling, in every
configuration it has. Measure it at more than one window size. Two columns are
preferred; three when two cannot fit. Balance columns against measured
heights, not estimates.

> *"make sure… the whole stack fits in one 16:9 fullscreen monitor field of
> view without a scroll bar"*
> *"I still think I want to go to a three-column layout… to avoid the need to
> scroll"*
> *"I don't want scrolling."*

### Full height, and only panes scroll

A screen with a list and an actions column takes the window's height; the
list scrolls inside its frame and the actions column stays in view as one
continuous tile, at every window size.

> *"Should we make the right-side bar with the buttons always keep the buttons
> in view?"*
> *"I'd like the right-side controls column to be one continuous tile that's
> always on the screen regardless of the window size."*

### Tighten

Remove whitespace a better arrangement would absorb: fields side by side
instead of stacked, a graphic beside the controls instead of under them,
actions on the title row instead of a row of their own. But not so far that
text is squeezed.

> *"Put the Throttle and Duration controls side-by-side to save height."*
> *"Put 'Stop all' in the title bar, also to save height."*
> *"we overshot the spacing… They're pretty squished now and we have room to
> spare."*

### Split a screen by sitting, not by length

Two things that are set at different times belong on different screens even
if one screen could hold both; things done together stay together.

> *"Ok, do the separate filters page."*

### Dialogs are compact and uniform

A dialog is as small as its content: stacked buttons where that saves width,
uniform padding, matched field widths across its variants.

> *"vertically stack them so the window is smaller"*
> *"make sure the TCP, UDP, and websocket connect pop-ups are visually
> consistent with uniform padding, reasonable width, and matched-width input
> fields"*

---

## 5. Controls and interaction

### Actions on the title row

A card's actions sit right-aligned on its title row; the body holds settings.
One orange (primary) action per region; red only for destructive actions.

> *"I like actions in the header."*

### Writing changes

Per-card Revert and Write (with a count) on the title row, appearing when
something is staged; a column of actions keeps its Write always present. A
setting that is live-adjusted, or that gates other settings, writes on change
and confirms inline — and a gating one re-reads what it exposes in the
background. No global Write shared between screens. Leaving a screen with
unwritten changes asks.

> *"I kinda want to encourage changes to be written on a per-page basis. In
> fact, I'd like a warning if there are unwritten changes when the user tries
> to navigate to a different page."*
> *"Put the revert, write, and reboot controls in the title."*
> *"The settings… need to auto-save because they're frequently live
> adjusted."*
> *"Let's make the OSD type selection automatically write, then trigger a
> background parameter refresh."*

### Restarts are prompted, and the app comes back

A change that needs a restart raises one prompt with a *Later*; the app
reconnects by itself, lands back on the same screen, and blocks conflicting
actions until it does.

> *"Present it in a pop-up to make the user more likely to execute it, but
> still have a 'later' button so they can defer."*
> *"When a reboot is triggered, can we make the app land back on the same page
> after reconnecting?"*

### Rare settings behind a dialog

Settings that are set once and rarely touched live behind a button that opens
a dialog with its own Write — not as permanent rows.

> *"Settings like DShot Rate and DShot ESC type should be behind a pop-out ESC
> settings menu."*
> *"give the ESC settings pop-up its own parameter write controls"*

### Work it out; ask only when you can't

Detect what can be detected, fill in what can be derived, and prompt only when
the attempt fails or is ambiguous. Background work never raises a prompt.

> *"Run the board detection in the background after the user chooses, only
> prompting the user to specify the target if it fails."*
> *"can we make it automatically detect the bootloader port?"*

### Point, don't type

Where a value comes from somewhere else (a place, a heading), pick it by
gesture and show the result as a readout.

> *"We need to be able to pick the flying field from the map rather than
> entering lat/long."*

### Related controls sit together

A control that enables, selects or scopes another sits right beside it. A
setting that stamps the next item goes on that item's header.

> *"The control for enabling a screen is too far from the control for
> selecting the screen."*

### Show the value behind a name

Where a named option stands for a number that matters, show both.

> *"Please add the numerical value to the string entries for input time
> constant."*

### Guard the dangerous, confirm briefly

An action that can hurt (reboot a flying vehicle, overwrite a configuration)
is refused or confirmed in a short dialog — the reassurance lives there, not
as standing text.

> *"we need a guard to prevent it from being done when a vehicle is connected
> and/or in flight"*
> *"The pop-up for flashing confirmation is too verbose."*

### Disabled looks disabled, quietly

A disabled control is greyed; no "not allowed" cursor, no hover effect.

> *"I think it's OK to inhibit the buttons when the values are equal, I just
> don't want the red slash."*

### Make a multi-step flow visible

A process with an order numbers its steps; a single action at the end
completes it.

> *"number the sections to create an obvious flow"*

### A flow ends by itself

A wizard that succeeds closes itself and leaves a brief word where it was
started ("Calibration saved" on the card's title row), and anything that
follows — a restart — goes through the app's usual prompt. A dialog left open
on "Saved, now go and reboot" has no ending. A failure is the case that keeps
the dialog open, with a retry of exactly what failed.

> *"We don't really seem to have any sort of calibration complete flow."*

---

## 6. States

### Offer what can be done now

With no device connected, screens that need one leave the navigation; screens
that work on a document stay. Don't build UI that exists only in the
disconnected state.

> *"Generally I'd like to avoid dedicated UI elements that only show when not
> connected to a vehicle."*

### Render, don't describe

A screen that cannot be used yet is drawn with its controls disabled and
placeholders in its readings — never replaced by a card describing what it
would show. Put the one-line prompt where the absence already shows.

> *"I think it should [render] — just with inputs disabled until the OSD is
> enabled."*
> *"No need for the notice bar — the 'No vehicle' on the visualization is
> enough."*

### Identical states look identical

The same state ("waiting for data") is the same text, font and place
everywhere it appears.

> *"hide the filter in the status tab when disconnected, so that waiting for
> telemetry looks identical across all three"*

---

## 7. Process

### Don't build what wasn't asked for

Test rigs, demo fixtures and scaffolding cost time; ask first, in one line.

> *"In the future, please ask me if something is necessary before spending
> that much time on it."*

### Offer choices for visual decisions

For a layout or visual question, render several options (static images or
live variants) and let the choice be made by looking.

> *"Please think of a handful (at least 4) potential UI/UX arrangements…
> and present me with mock-ups to choose from."*
> *"Render some alternate visualization ideas and I'll pick one."*

### Learn from the references

Read how the established tools (and their source) do it before designing;
borrow the parts that are better and say why.

> *"Check what QGroundControl and Betaflight do with their headers — read the
> source if necessary — and propose some options."*

### Verify by running it

Check every change in the running app, at more than one window size and in
every configuration, with real hardware when it is on the bench. Measure
rather than estimate; report the numbers.

> *"Do it, I want to see how it looks."*
> *"please implement A so I can see if that actually happens"*

### Keep the rules current

When a review produces a preference that will apply again, add it here with
its quote.

> *"It might be worth recording my stylistic preferences over time to try and
> create some sort of convention/rule."*
