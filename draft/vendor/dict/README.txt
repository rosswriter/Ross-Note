en-GB.words: every word form of the British English Hunspell dictionary (hunspell-en-gb 1:24.2.1, from
LibreOffice's dictionaries: Marco Pinto and contributors; LGPL/MPL/GPL tri-licence, see the hunspell-en-gb
package), expanded with Hunspell's unmunch. One word a line, sorted; each line starts with one character
(chr(48 + n)) giving how many letters it shares with the line before, then the rest of the word.
en-GB.common: the 30,000 commonest of them, commonest first (from wordfreq's English list, CC BY-SA 4.0):
used only to put spelling suggestions in a sensible order.

(RossDraft 1.15.0) en-US, fr, es, de, pt-BR, it, nl .words / .common: made by tools/make_dicts.py from LibreOffice's
Hunspell dictionaries (the npm "dictionary-xx" packages, wooorm/dictionaries; each under its own licence: en-US MIT
and BSD, fr MPL-2.0, es GPL-3.0/LGPL-3.0/MPL-1.1, de GPL-2.0/GPL-3.0, pt-BR (VERO) LGPL-3.0/MPL-2.0, it GPL-3.0,
nl BSD-3-Clause/CC-BY-3.0): every word form in wordfreq's large list for the language that the dictionary accepts
(checked with spylls), the dictionary's own words, and for en-US, es, de and nl every form Hunspell's unmunch makes.
