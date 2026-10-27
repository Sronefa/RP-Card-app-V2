# Writing MVU engine cards

How the best Chinese MVU (MagVarUpdate) cards are built, gathered from MagVarUpdate's tutorial, the worldbook-skill MVU guide, the wuxia mvu-variable-framework skill, sillytavern-card-maker and the opizontas wiki. CardForge's engine writes the MVU format, so the same habits apply.

## Plan the variables first

Decide what the story has to remember before writing any prose. About six core numbers is the ceiling: each extra number dilutes the model's attention. Every core number gets tiers (ranges with a name) that change how characters behave, and threshold events that fire when a tier is crossed (a confession at 80 affection, a breakdown at 0 sanity).

## Numbers live in variables, not prose

The description and greetings never state a value ("her trust in you is 40"): the state block at depth 1 already says it, and two sources drift apart. Tier behaviour goes in rules or keyed lorebook entries, not in the description, so the description stays true at every value.

## Names and shapes

- Fixed variable names: `protagonist`, never `{{user}}` in a path; the macro changes per persona and breaks paths.
- Records keyed by name (`NPCs: { Mira: { affection: 20 } }`) over arrays of objects: paths stay stable.
- `_` marks a read-only constant (the model sees it, can't change it); `$` marks a hidden field (secret arc progress, a hidden traitor flag).
- Lists stay one level deep. A list of lists is where models make mistakes.

## Worldbook layout

World facts and rules come first and are always on, before the character. Character and NPC entries are keyed and come after. The current variable list sits at depth 0 or 1, near the end of the prompt. Every entry has its own order number, so nothing ties.

## Update rules

Each rule names the trigger, the size of the change ("+3 to +6", not "goes up"), when not to change it, when to remove an entry, and caps on lists ("at most 5 items; drop the oldest"). Read-only values get no rule. Ask for a short analysis step before the patch: the model thinks about what happened, then writes the change.

## Greetings carry their starting state

Each greeting starts the story in a different place, so it sets its own starting values: either a full init or a patch on the default (CardForge: an `<initvar>` block with the values that differ). Use one approach for every greeting. When the card has a character creator, greetings don't fix {{user}}'s looks or background.

## Output discipline

Entries that say where the update block goes, that stats never appear in the prose, and how long a reply is. Emotional pacing rules (how fast affection may move, how many beats a turnaround takes) keep numbers from jumping.

## Prose style

The card holds rules and facts; prose style stays mostly out of it. A short tone note is enough.
