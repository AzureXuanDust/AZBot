# build_times.json sources

480 base-template construction times were extracted on 2026-10-26 from [BWIKI 建造时间 revision 418975](https://wiki.biligame.com/blhx/index.php?title=建造时间&oldid=418975) (page updated 2026-10-23).

Only visible construction-table entries were used: commented-out historical ships were excluded. `舰娘头像` names and aliases were matched to CN `ship_data_statistics` and `ship_data_template`; NPC-only 900xxx templates were excluded. Disambiguation pages establish 皇家新月 (201091), 皇家约克 (203071), 铁血约克 (403111), SSSS莲 (10800031), 维纳斯霞 (10600031), and 航母天城 (307151). 倶/俱 and full-width punctuation were normalized for matching.

The current CN `ship_data_group` GETBOAT links contain 82 special, 147 light and 84 heavy candidates, and every candidate has a positive time in this file. Their rarity chances continue to come from `ship_data_create_material.rate_tip`. The construction table includes limited ships' times, but this file does not add an event pool or change pool membership.

The CN source intentionally differs from EN in several entries, including 小贝法 (202181, 01:25:00), 伊13 (317011, 00:33:20), 易北 (406021, 02:22:00), and 霞 from the DOA collaboration (10600031, 02:33:43). These values follow the cited construction table rather than the existing EN JSON.

Source rows and name-to-ID matches are recorded locally in `.cache/cn-serverdata-20261026/build-time-evidence.json`. This file contains no probabilities inferred from construction times.
