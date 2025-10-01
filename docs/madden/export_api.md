# Madden Export API

This is full documentation on the export API that Madden exposes via Companion App (or through direct EA connection)

I will also try to reference any gotchas in the data. 

## Routes

Key:
- Platform: console of the user
- LeagueID: EA league ID (safe to use as a key)

### League Info

#### `/{platform}/{leagueId}/leagueTeams`

[Example Response](./api_data/pc_2890093_leagueTeams.json)

This gets you the latest state of the teams in the league. 

> [!CAUTION]
> Team Id are not unique. When EA does title updates, team ids are subject to change!

`/{platform}/{leagueId}/standings`

[Example Response](./api_data/pc_2890093_standings.json)

This gets you the latest standings of the teams in the league

Useful Enumerations:

```
enum PlayoffStatus {
  ELIMINATED = 0,
  UNDECIDED = 1,
  CLINCHED_PLAYOFF_BERTH = 2, // x
  CLINCHED_DIVISION = 3, // y
  CLINCHED_TOP_SEED = 4 // z
}
```
> [!CAUTION]
> Team ID are not unique. When EA does title updates, team ids are subject to change!

### Weekly Data

All weeks are 1 indexed. So week 9 in game will export Week 9. 

Stage can be "pre" or "reg" for preaseason and regular season respectively.

Playoffs are weeks 19, 20, 21, 23 (skip Pro Bowl)

`/{platform}/{leagueId}/{week}/{stage}/schedules`

[Example Response](./api_data/pc_2890093_week1_1_schedules.json)

> [!CAUTION]
> Schedule Ids are not unique! they will be reused over seasons. Use weekIndex, seasonIndex, scheduleId for a unique key. However, during Title updates, there may be duplicates as well (with new team ids)

`/{platform}/{leagueId}/{week}/{stage}/punting`

[Example Response](./api_data/pc_2890093_week1_1_punting.json)

> [!CAUTION]
> Stat Ids are not unique! they will be reused over seasons. Use weekIndex, seasonIndex, statId for a unique key. However, during Title updates, there may be duplicates as well (with new team ids)

`/{platform}/{leagueId}/{week}/{stage}/kicking`

[Example Response](./api_data/pc_2890093_week1_1_kicking.json)

> [!CAUTION]
> Stat Ids are not unique! they will be reused over seasons. Use weekIndex, seasonIndex, statId for a unique key. However, during Title updates, there may be duplicates as well (with new team ids)

`/{platform}/{leagueId}/{week}/{stage}/rushing`

[Example Response](./api_data/pc_2890093_week1_1_rushing.json)

> [!CAUTION]
> Stat Ids are not unique! they will be reused over seasons. Use weekIndex, seasonIndex, statId for a unique key. However, during Title updates, there may be duplicates as well (with new team ids)

`/{platform}/{leagueId}/{week}/{stage}/defense`

[Example Response](./api_data/pc_2890093_week1_1_defense.json)

> [!CAUTION]
> Stat Ids are not unique! they will be reused over seasons. Use weekIndex, seasonIndex, statId for a unique key. However, during Title updates, there may be duplicates as well (with new team ids)

`/{platform}/{leagueId}/{week}/{stage}/receiving`

[Example Response](./api_data/pc_2890093_week1_1_receiving.json)

> [!CAUTION]
> Stat Ids are not unique! they will be reused over seasons. Use weekIndex, seasonIndex, statId for a unique key. However, during Title updates, there may be duplicates as well (with new team ids)

### Roster

Rosters are sent per team, and then one endpoint for Free Agents

> [!CAUTION]
> Free Agents are not sent via Companion App


`/{platform}/{leagueId}/team/{teamId}/roster`
`/{platform}/{leagueId}/freeagents/roster`

[Example Responses](./api_data/team_data)

> [!CAUTION]
> RosterId is not unique! Retired player ids will be reused, also during Title update duplicates will be generated. Generate a unique id using the following fields: presentationId, birthYear, birthMonth, birthDay. These fields are not editable in game

> [!CAUTION]
> Retired Players are not marked in anyway. They will just not be exported anymore
