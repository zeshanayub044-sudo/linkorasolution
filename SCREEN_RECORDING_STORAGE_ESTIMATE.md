# Screen recording storage estimate

Pre-deployment audit on 2026-10-09: four active Employee profiles, two active Co-CEO profiles (six potential portal attendees), four inactive Employee profiles. Existing buckets contain approximately 27 KB; neither is suitable for screen recordings. A dedicated private Supabase bucket is provisioned. The billing plan, available quota, overage permission and monetary budget are not verified; recording is disabled until the owner approves them. Do not assume free storage can hold this workload.

Estimates use decimal GB, target 500,000 bits/second, video only, eight-hour shifts and 26 working days/month. Existing attendance expectation is seven hours; the eight-hour model is the conservative requested planning scenario. Three working months = 78 workdays. Actual 90 calendar days vary with holidays/weekends; continuous daily recording is shown separately. Encoder rate is variable and these are estimates, not a purchased quota or guaranteed compression ratio.

`GB = bitrate / 8 × hours × 3600 × workdays × people / 1,000,000,000`

| Workload | Per 8-hour day | 26 workdays/month | 78 workdays / ~90 days |
|---|---:|---:|---:|
| One person | 1.80 GB | 46.80 GB | 140.40 GB |
| Four Employees | 7.20 GB | 187.20 GB | 561.60 GB |
| Six attendees including Co-CEOs | 10.80 GB | 280.80 GB | 842.40 GB |
| One person, every calendar day | 1.80 GB | 54.00 GB / 30 days | 162.00 GB / 90 days |
| Six people, every calendar day | 10.80 GB | 324.00 GB / 30 days | 972.00 GB / 90 days |

At 200 kbps multiply by 0.4; 1 Mbps multiply by 2; 1.5 Mbps multiply by 3. Before raising settings, approve both storage and upload bandwidth. Plan at least 20–30% margin over measured steady-state use, plus cleanup delay, variable encoder rate and any other project buckets. At 500 kbps a 60-second file targets 3.75 MB and an eight-hour day has 480 files/person; six people over 78 days is ~224,640 objects and per-segment events. Row/path/recording/date/retention indexes and paginated metadata avoid loading that corpus in a browser.

Supabase standard upload is recommended for files up to 6 MB ([official upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads)); the encoder rotates at 6 MB and hard rejects above the private 8 MiB bucket limit. No TUS/resumable uploader is claimed. Retry repeats an immutable short file. If actual files consistently exceed target, lower rate/FPS, measure quality and capacity, or review a future approved resumable/object-store design; do not make the bucket public or remove safeguards.

Live WebRTC traffic, Storage upload/download egress, database/Edge requests and backups are separate costs. One full archived review transfers roughly another 1.8 GB/person/day at target rate, and repeated review increases egress. No currency cost is asserted without the actual approved account plan. FPS reduction alone is not a proportional storage guarantee because content/codec/bitrate vary.

The admin summary shows verified recording bytes, last 30-day ingestion, oldest retained record, expiring/overdue counts, projected 90-day requirement and configured recording budget; warning starts at 80%. Global server reservations count pending+stored bytes under a serial quota lock and refuse reservations beyond that budget. This is a recording allocation, not a live Supabase total-quota API: budget must exclude unrelated buckets, and external uploads/deletion backlog can cause additional usage. A full budget prevents new recorded starts or interrupts uploads visibly; it never silently fabricates complete video. Configure actual paid capacity before activation.

After employee acceptance, measure real 30-day byte ingestion, multiply roughly by three, adjust workdays/headcount/rate, leave margin, and monitor overdue removal/egress. Alternatives such as approved S3/R2 remain future architecture decisions if project limits or cost make this Supabase allocation unsuitable; no external object store is silently configured.
