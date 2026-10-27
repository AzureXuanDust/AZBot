# world_port_pools.json sources

Checked on 2026-10-26 against [BWIKI 港口商店 revision 294647](https://wiki.biligame.com/blhx/index.php?title=港口商店&oldid=294647), the historical CN lists before the 2023-08-31 shop rearrangement. The page credits 怒怒酱 and 蓝耀、寂寞、茉子、渡鸦、卯处、封尘半夏.

150 entries match CN `world_goods_data` by item name, count, currency and price: NY 31, 利维浦 36, 直布罗特 41 and 圣彼得伯格 42. Existing upstream IDs are kept only after this per-port multiset match; an EN assignment alone is not accepted as evidence.

Four entries are not included: 40201, 40202 (NY) and 40203, 40204 (利维浦). The historical wiki labels their 500/1000-coin rewards 豪华应急维修箱（组件）, but the current goods rows identify item 202 (豪华维修箱), not item 204 (the component kit). No choice between these conflicting identities is guessed.

This is a partial **legacy** pool. Current monthly shops use CN `world_newshop_data` and its own port/unlock settings; this JSON does not replace them. Match records and excluded rows are in `.cache/cn-serverdata-20261026/world-shop-evidence.json`.