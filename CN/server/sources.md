# CN server-data sources (2026-10-26)

These files use the current upstream schemas. Data were checked online through the BWIKI MediaWiki API and pinned CN client sources on 2026-10-26 and matched to the repository's CN tables. EN JSON is not evidence of a CN-only rule. The original EN files remain unchanged.

| File | Verified content | Limits |
| --- | --- | --- |
| `build_times.json` | 480 base ship IDs; all 82 special, 147 light and 84 heavy pool candidates have a time | Pool membership and rarity rates still come from CN client tables; no event pool is invented |
| `meowfficer_times.json` | All 27 trainable CN cats, names matched to `commander_data_template` | Special non-training cats have no artificial training time |
| `meowfficer_talents.json` | 27 observed initial talent pools, rarity-dependent possible sets, 29 fixed-only talents | Public sources do not give set/member odds; upstream still samples uniformly |
| `cattery_play_awards.json` | Guaranteed training tools for pools 55000/55001/55002: 1/1/2 per cat | Furniture coins are omitted because exact counts/chances are not published; EN's guessed 50% is not copied |
| `drop_packs.json` | 20 faction tech boxes, 3 development support boxes, 1 Sakura display box; CN item/equipment IDs and published rarity percentages | Within-rarity selection remains upstream's uniform sampling. Other unsupported packs are not assigned invented rewards |
| `coloring_awards.json` | 21 picture rewards for CN Lunar New Year 2024/2025/2026 | Random T3 book count/category is known, individual book odds are not. The stopped 2023 Jupiter activity is outside this file |
| `daily_awards.json` | 27 stages: exact published tier counts and bounded cognitive-chip rank amounts, checked against equivalent CN/EN client reward entries | Some counts are cross-region wiki evidence, not CN captures. Approximate coin amounts, missing Lv35 counts and conflicting Lv95 Fierce Assault chances are omitted |
| `battle_exp.json` | Published ship score/morale multipliers and commander fleet-size/score/level-gap factors | The pre-existing upstream `scenarioExpRate=2` is not established by these sources as a universal CN multiplier |
| `meowfficer_battle_exp.json` | Published ship-type/rarity/star formula, normal/boss factors, normal chapters 1-14 and hard chapters 1-12 | Data opt into known-only coverage; unverified maps/types do not receive guessed partial EXP. Operation Siren uses a separate formula outside this table |
| `world_port_pools.json` | 150 legacy shop entries matched by item, quantity, currency and price to the historical CN shop lists | Four entries have a source label conflict and are excluded; this does not replace the current client-defined `world_newshop_data` |
| `juus_posts.txtpb` | Posts 20001/20002 with verified CN bodies, images and 39 reachable NPC nodes; explicit placeholders for the other 19 current automatic-queue IDs | All 21 IDs are covered; placeholders have no unverified images/comments/options. No EN translations, invented stories, player reply schedules or official global like counts. See `juus_posts.sources.md` |
| Existing `new_commander.json` | Retained unchanged | Its existing source note explicitly says it is an EN starting kit; no new CN capture was obtained |

## Sources

- [BWIKI 建造时间, revision 418975](https://wiki.biligame.com/blhx/index.php?title=建造时间&oldid=418975), updated 2026-10-23. Disambiguation also checked against the pages for 新月, 约克DE, 莲SSSS, 霞DOA and 天城CV. See `build_times.sources.md`.
- [BWIKI 指挥喵, revision 419171](https://wiki.biligame.com/blhx/index.php?title=指挥喵&oldid=419171), updated 2026-10-25. Training times were also fetched from its semantic query (`[[分类:指挥喵]]`, properties `训练时间` and `稀有度`). Initial talent pool and yellow fixed-only rows were mapped by CN ability names.
- [BWIKI 科技箱, revision 405327](https://wiki.biligame.com/blhx/index.php?title=科技箱&oldid=405327), equipment lists collected by 碧蓝海事局. Equipment-page faction and type distinguish repeated names. The client IDs are **30205 = Iris, 30207 = Sardegna, 30208 = Northern Parliament**; 30204 is an appointed box and is not converted into a random box.
- [BWIKI 每日挑战, revision 412911](https://wiki.biligame.com/blhx/index.php?title=每日挑战&oldid=412911), and [Azur Lane Wiki Daily Raid](https://azurlane.koumakan.jp/wiki/Daily_Raid), retrieved 2026-10-26. Before using the published numeric counts, corresponding CN/EN `award_display` entries were compared after translating `%概率` to `%chance`; qualitative coin descriptions were excluded. Lv60 B-rank 45 is rejected because CN says 46-50.
- [BWIKI 2024东煌春节, revision 332109](https://wiki.biligame.com/blhx/index.php?title=碧蓝海事局2024东煌春节活动专题&oldid=332109), [2025, revision 375248](https://wiki.biligame.com/blhx/index.php?title=碧蓝海事局2025东煌春节活动专题&oldid=375248), [2026, revision 399295](https://wiki.biligame.com/blhx/index.php?title=碧蓝海事局2026东煌春节活动专题&oldid=399295). Award IDs come from each CN activity's `config_data`; the 2025 third and fifth pictures give **玉竹泡泡机 (furniture 318107)**, not the EN file's parts/Plum-Petal Poetry.
- [BWIKI 战斗评分, revision 195045](https://wiki.biligame.com/blhx/index.php?title=战斗评分&oldid=195045), by 尼克妮可妮 and listed contributors; [心情, revision 229324](https://wiki.biligame.com/blhx/index.php?title=心情&oldid=229324); [公式合集, revision 395828](https://wiki.biligame.com/blhx/index.php?title=公式合集&oldid=395828). The commander formula multiplies score by the 50%/10% level-gap factor, then truncates. The cat page's six-rainbow-ship example explicitly covers super cruisers as heavy cruisers.
- [BWIKI historical 港口商店, revision 294647](https://wiki.biligame.com/blhx/index.php?title=港口商店&oldid=294647), by 怒怒酱 and credited collectors, before the 2023-08-31 layout change. See `world_port_pools.sources.md`.

## Runtime support

Three narrow reader/calculation changes are required for these CN files:

- Daily `award_display` recognizes CN `%概率` as well as EN `%chance`; otherwise the supplied tier counts cannot be used.
- `battle_exp.json` may set `player_exp.multiply_level_gap` and `player_exp.round_down`. Both default to false, preserving existing EN behavior.
- `meowfficer_battle_exp.json` may set `known_only` and `map_limits`. CN enables them to prevent extrapolation beyond the cited maps or giving a partial formula to an unlisted ship type. Other existing files keep their previous behavior.

The data are loaded at process startup. Use a binary built with these reader changes and restart to reload the JSON. Changing the files does not modify a saved build's already stored ship/time.

## Unavailable evidence

No `juus_option_replies.json` was fabricated. [BWIKI JUUs动态, revision 411894](https://wiki.biligame.com/blhx/index.php?title=JUUs动态&oldid=411894) documents replies arriving after a while and contains some transcripts, but it does not supply an exact CN post-ID/option/NPC-ID/delay schedule. The EN file is an observed EN schedule, which is not proof of CN timing. A CN server capture is needed to fill it accurately. The separate `juus_posts.txtpb` restores 20001/20002 from verified archived CN references and marks 20003-20016 and 674-678 as placeholders. This covers the current 21-post automatic queue without claiming that the other CN transcripts have been recovered. Images, NPC comments and player options are empty for placeholders; EN translations and locally written stories are excluded.

The published sources also do not establish furniture-coin probabilities, exact daily coin quantities, all within-pool weights, or the CN new-account starting kit. Empty placeholder JSON and guessed percentages were deliberately not used to claim completeness.

Raw API responses, revision identifiers, extraction records and verification output are retained locally under `.cache/cn-serverdata-20261026/`; those research artifacts are not game inputs.
