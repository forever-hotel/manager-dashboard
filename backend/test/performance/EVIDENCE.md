# DDP-047 performance evidence

Status: **NOT_ACCEPTED / NOT_RUN**. No performance result is asserted.

| Required evidence                                                   | Recorded value                                   |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| Candidate SHA / baseline SHA / PR / Jira                            | Pending                                          |
| Accepted DDP-046 and DDP-054 links                                  | Pending                                          |
| Green CI / measured changed-code and tool coverage                  | Pending                                          |
| Workload profile/version and owner approval                         | Proposed DDP-047-read-v1; pending owner sign-off |
| UI timing resolution / percentile approval                          | Proposed <=1000ms for every observation; pending |
| Test date/time / timezone                                           | Pending / Asia/Colombo                           |
| Provider/DB/schema/gateway revisions and URLs                       | Pending                                          |
| Dataset volumes / age / expected aggregates                         | Pending                                          |
| Distinct synthetic user count / private session references          | Pending                                          |
| Hardware / limits / replicas / DB tier / broker / load generator    | Pending                                          |
| Network RTT / clock synchronization offsets and uncertainty         | Pending                                          |
| Source event rates / event families / browser cohort                | Pending                                          |
| 100-user results / duration / p50/p95/p99 / errors / missed slots   | Pending                                          |
| 300-user results / duration / p50/p95/p99 / errors / missed slots   | Pending                                          |
| Socket establishment / steady-state connected counts / disconnects  | Pending                                          |
| Complete source-event to all protocol-client receipt reconciliation | Pending                                          |
| Source commit / receipt / visible UI timing evidence for both loads | Pending                                          |
| Baseline comparison / evaluator output                              | Pending                                          |
| DB queries / resource telemetry / broker backlog                    | Pending                                          |
| KMS/FOSS 100-order processing evidence and MAD visibility           | Pending                                          |
| Defects / fixes / failed runs / final-candidate retests             | Pending                                          |
| Cleanup / restored health / private credential expiry               | Pending                                          |
| Peer / infrastructure / subsystem owner approval and date           | Pending                                          |

Link sanitized restricted artifacts, never JWT files or credential values. Preserve
one record per candidate/run, including failures. All variants in the
[register](acceptance-register.csv) must pass before a parent AC can pass.
