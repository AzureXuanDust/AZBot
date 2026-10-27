# CN juus_posts.txtpb sources

Reviewed on 2026-10-26 under the user's CN-only policy: retain content established by online CN sources and use explicit placeholders for everything else. The file covers the current 21-post automatic queue: two reconstructed CN posts and 19 placeholders. It contains no EN translations or locally written story content. The reconstruction is based on explicit archived CN client data; no CN packet capture was obtained.

## Primary sources

AzurLaneTools/AzurLaneLuaScripts commit `8f30769b6198429f8f2024d0dcc9721dace5729a` (2026-04-09, CN 9.6.641):

- [activity_ins_template.lua](https://github.com/AzurLaneTools/AzurLaneLuaScripts/blob/8f30769b6198429f8f2024d0dcc9721dace5729a/CN/sharecfg/activity_ins_template.lua): explicit post IDs, body keys, image URLs, publication times and root NPC IDs.
- [activity_ins_language.lua](https://github.com/AzurLaneTools/AzurLaneLuaScripts/blob/8f30769b6198429f8f2024d0dcc9721dace5729a/CN/sharecfg/activity_ins_language.lua): bodies and NPC text.
- [activity_ins_npc_template.lua](https://github.com/AzurLaneTools/AzurLaneLuaScripts/blob/8f30769b6198429f8f2024d0dcc9721dace5729a/CN/sharecfg/activity_ins_npc_template.lua): NPC identities, timestamps and explicit child replies.
- [activity_ins_ship_group_template.lua](https://github.com/AzurLaneTools/AzurLaneLuaScripts/blob/8f30769b6198429f8f2024d0dcc9721dace5729a/CN/sharecfg/activity_ins_ship_group_template.lua): NPC portrait references.

Commit [`ee129a7083071468fbc77cdc0b2dea9dbeb86f0f`](https://github.com/AzurLaneTools/AzurLaneLuaScripts/blob/ee129a7083071468fbc77cdc0b2dea9dbeb86f0f/CN/sharecfg/activity_ins_template.lua) (2026-04-17, CN 9.6.657) clears these persisted fields and sets `is_active=1`, requiring the server to provide the content. Both versions were fetched anew; the intervening 2026-04-10 revision was also checked.

The archived IDs/type/group/title/publication time match the current repository CN table. Every referenced text, NPC identity, timestamp and reply edge matches the local current CN Lua dump; the portraits match the repository's current CN group table. Lua string escapes are decoded as literals and preserved, without executing downloaded Lua or inferring associations from similar numeric IDs.

## Contents

| Post | Title | Publication time (UTC+8) | Root comments | All reachable NPCs |
| --- | --- | --- | --- | --- |
| 20001 | 欢迎关注啾啾热点频道！ | 2026-03-26 13:00:00 | 15 | 21 |
| 20002 | 【港区新闻】萨拉托加电影制片厂引进新技术 | 2026-03-26 13:05:00 | 9 | 18 |

Root comments are emitted as `npc_discuss`; their referenced descendants are emitted as `npc_reply`. The original four CN image URLs are retained. HEAD requests on 2026-10-26 returned HTTP 200 and `image/png` for all four; image bodies were not downloaded.

There are no inferred player comment options or delayed player-response schedules. Global like counts are not known: `good`, `is_good` and `is_read` start at zero as local state. The existing server then persists each commander's activation, like and read state.

## Scope

The repository's current CN `activity_ins_template` contains 21 posts selected by the client's automatic-queue rule, `is_active == 1` or official-account `type == 2`. All have passed their configured publication dates as of 2026-10-26. Posts 20001/20002 retain the verified content above. Posts 20003-20016 and 674-678 use exactly `【占位】动态 <id> 的国服内容尚未核实。` as their body. Their IDs and publication times come from the current CN table; their images, NPC comments, replies and player options are empty. A placeholder is not an official transcript.

The online sources reviewed did not establish complete CN bodies, image mappings and comment trees for those 19 posts. Matching EN IDs, translations and original story text are not used as substitutes. Both the list and detail image loaders in the local CN client (`instagramlayer.lua:72`, `instagramchatlayer.lua:1832`) hide empty images and complete their load callbacks, so these placeholders need no replacement artwork.

The exact player-option-to-NPC mapping and delays required by `juus_option_replies.json` remain a separate evidence gap. No player options or delayed replies are invented. Like/read counts are local state rather than official popularity data. Future IDs outside the current queue remain unsupported until explicitly reviewed and added.

## Verification and use

`TestCNJuusServerPosts` checks all 21 queue IDs and CN publication times, the exact placeholder text and empty media/comments, the two verified CN posts and their acyclic NPC trees, chronological activation and retries, repeated likes, read state, player isolation, rejection of an unconfigured ID, SQLite reopen persistence and the complete list's wire-frame round trip.

The current upstream reader already accepts this `SC_11706` text-protobuf format. No production Go code or binary change is required; restart the server with `BELFAST_DATA` pointing to the project data root to load it.

Fetched source bytes and their SHA256 records, extracted field-level evidence, image HEAD results and generation code are retained locally under `.cache/juus-posts-20261026/`.

The current CN-only classification and generated post records are retained in `.cache/juus-complete-20261026/cn-only-manifest.json` and `cn-only-posts.json`. Earlier translation drafts in that cache are excluded from the runtime file and are not evidence for CN content.
