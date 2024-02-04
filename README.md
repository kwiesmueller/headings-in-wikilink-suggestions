# Headings in Suggestions

This plugin patches (**DANGER**) the built-in suggestion code called
when starting `[[` wiki links to add global headings to the suggestions by default.

When starting a wiki link, suggestions from both `[[` and `[[##` modes are combined
into a single response list and sorted (by some still WIP rule).

A new `[[//` file only suggestion mode is added and the prefix used can be modified in settings.
