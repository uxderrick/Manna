# Song Detection: Seed Download List (20 pairs)

Built around the church's repertoire: Maverick City, Hillsong, Bethel and Elevation, plus a few classics used as traps.
Get audio from purchased sources (iTunes, Amazon, Bandcamp). Save it to `~/manna-song-data/reference/audio/` as `<slug>__<a|b>__<artist>.<ext>`.

## Section A: same song, two versions (14 pairs)
Both versions get the **same `song_id`**. This tests that changes in key, tempo, singer and arrangement don't break matching.
For version B, prefer a **different lead voice or key** (male vs female, live vs studio, another church choir's cover). The more different it is, the better the test.

| # | Slug | Song | Version A | Version B | Notes |
|---|---|---|---|---|---|
| A1 | `way-maker` | Way Maker | Sinach (original) | Leeland | Different singer, gender and arrangement |
| A2 | `goodness-of-god` | Goodness of God | Bethel Music (Jenn Johnson) | CeCe Winans | Different singer and style |
| A3 | `firm-foundation` | Firm Foundation (He Won't) | Cody Carnes (2021) | Maverick City Music ft. Chandler Moore & Cody Carnes (2022) | Gospel vs CCM arrangement |
| A4 | `holy-spirit` | Holy Spirit (Torwalt) | Francesca Battistelli | Jesus Culture (Kim Walker-Smith) | Two female leads, different band feel |
| A5 | `oceans` | Oceans (Where Feet May Fail) | Hillsong UNITED (studio) | Any Hillsong UNITED live version | Live room and tempo drift |
| A6 | `what-a-beautiful-name` | What a Beautiful Name | Hillsong Worship (studio) | Any live version or church-choir cover | |
| A7 | `who-you-say-i-am` | Who You Say I Am | Hillsong Worship | Any live version or cover | |
| A8 | `reckless-love` | Reckless Love | Cory Asbury (studio) | JJ Hairston & Youthful Praise (*Miracle Worker*, 2019, track 14) | Same lyrics, gospel style. Good test of style and arrangement. Writer credits not yet confirmed: if the melody differs from Asbury's, move this to Section B as a trap. |
| A9 | `raise-a-hallelujah` | Raise a Hallelujah | Bethel Music (Jonathan & Melissa Helser) | Any live version or choir cover | |
| A10 | `jireh` | Jireh | Elevation Worship & Maverick City | Any live version or choir cover | |
| A11 | `promises` | Promises | Maverick City Music (Naomi Raine & Joe L Barnes) | Any live version or choir cover | Possibly 6/8: **check on the chord chart** |
| A12 | `man-of-your-word` | Man of Your Word | Maverick City Music (Chandler Moore & KJ Scriven) | Any live version or cover | |
| A13 | `graves-into-gardens` | Graves into Gardens | Elevation Worship ft. Brandon Lake | Any live version or cover | |
| A14 | `great-is-thy-faithfulness` | Great Is Thy Faithfulness | Traditional hymn or choir recording | Any modern worship arrangement | **3/4 meter** test; a Hymnary.org score also exists |

## Section B: trap pairs, different songs that must NOT be confused (6 pairs)
Each side gets its **own `song_id`**. This tests that the keys separate songs with a similar title, the same words or the same singer.

| # | Song 1 | Song 2 | Trap |
|---|---|---|---|
| B1 | The Lord's Prayer: Hillsong Worship (2018, *There Is More*) | The Lord's Prayer: Albert Hay Malotte classic setting (any choir or solo recording) | **Same title, different melody.** No Bethel "Lord's Prayer" could be confirmed, so the Malotte setting replaces it. |
| B2 | Cornerstone: Hillsong Worship | My Hope Is Built on Nothing Less: hymn, *Solid Rock* tune | **Same verse words, different melody.** Lyrics can't separate these, but melody can. |
| B3 | Way Maker: Sinach | God Will Make a Way: Don Moen | Same theme and phrase ("way") |
| B4 | Jireh: Elevation & Maverick City | Jehovah Jireh: classic chorus (Merla Watson) | Overlapping title words |
| B5 | Raise a Hallelujah: Jonathan & Melissa Helser | No Longer Slaves: Jonathan & Melissa Helser | **Same singers**, different song. Voice must not drive the match. |
| B6 | Wait On You: Elevation & Maverick City (Dante Bowe, Chandler Moore) | Man of Your Word: Maverick City (Chandler Moore, KJ Scriven) | Same lead singer and gospel style |

## Download count
36 unique audio files: 28 from Section A, plus the B-side songs not already in Section A (Malotte Lord's Prayer, Hillsong Lord's Prayer, Cornerstone, My Hope Is Built, God Will Make a Way, Jehovah Jireh, No Longer Slaves, Wait On You). B5 and B6 reuse A9 and A12.

## Then record queries (yourself)
For the songs you know well (at least 10), follow the recording protocol in [data-plan.md](./data-plan.md#recording-protocol-user-phone-is-fine-about-12-min-per-clip): voice in two keys, hum, keys melody and keys chords.
Priority: A1, A2, A3, A9, A10 and all of Section B. These are the hardest and most useful tests.

## To verify while downloading
- Time signature of `promises`, and any other song that feels like 6/8. Check it on its chord chart.
- Write the key and BPM of each version into `manifest.csv`, from the chord chart or by ear.
