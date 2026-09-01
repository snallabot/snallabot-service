# Commissioner Commands

These are companion app commands for league admin/commissioner actions, sent as POST requests with a JSON envelope. Unlike the read-only export routes above, these mutate league state.

## Request Format

All commands share the same envelope structure:

```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":<timestamp>,\"deviceId\":\"<deviceId>\",\"commandName\":\"<commandName>\",\"componentId\":<componentId>,\"commandId\":<commandId>,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"<jsonEncodedPayloadString>\",\"componentName\":\"franchisemode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

> [!NOTE]
> `messageExpirationTime` is a unix timestamp; commands appear to be rejected after this expires. Generate a fresh value close to send time.

---

### Toggle AutoPilot
`Mobile_UserAdmin_ToggleAutoPilot`

Toggles autopilot (CPU control) on/off for a user's team.

- componentId: `2050`
- commandId: `9110`
- componentName: `franchisemode`

Payload:
```json
{
    "actionTimeout": <int>,
    "ToggleAutoPilotUserId": <userId>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1787795536,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_UserAdmin_ToggleAutoPilot\",\"componentId\":2050,\"commandId\":9110,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"actionTimeout\\\":2,\\\"ToggleAutoPilotUserId\\\":417448296,\\\"leagueId\\\":15769259}\",\"componentName\":\"careermode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```
> [!NOTE]
> `actionTimeout` of `0` sets autopilot off. Non-zero values are presumed to set an autopilot duration/mode; unconfirmed.

---

### Submit Response (Ready for Advance)
`Mobile_Career_SubmitResponse`

Signals that a user is ready to advance the week/stage. Any user can send this for themselves.

- componentId: `2060`
- commandId: `824`
- componentName: `franchisemode`

Payload:
```json
{
    "requestId": <requestId>,
    "responseKey": <responseKey>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1787795832,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_Career_SubmitResponse\",\"componentId\":2060,\"commandId\":824,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"requestId\\\":20457,\\\"responseKey\\\":79822849,\\\"leagueId\\\":2890093}\",\"componentName\":\"careermode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Submit Response (Force Advance)
`Mobile_Career_SubmitResponse`

Same command as above, but sent by a commissioner to force the league to advance regardless of other users' readiness.

- componentId: `2060`
- commandId: `824`
- componentName: `franchisemode`

Payload:
```json
{
    "requestId": <requestId>,
    "responseKey": <responseKey>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1788245255,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_Career_SubmitResponse\",\"componentId\":2060,\"commandId\":824,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"requestId\\\":4864,\\\"responseKey\\\":81657856,\\\"leagueId\\\":2282363}\",\"componentName\":\"franchisemode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```
> [!NOTE]
> Identical `commandName`/`componentId`/`commandId`/payload shape to "Ready for Advance" above. The difference is that the sending user must be a league commissioner/admin for it to force the advance rather than just mark themselves ready.

---

### Force Home Win
`Mobile_GameSchedule_ForceHomeWin`

Forces a scheduled game to resolve as a home team win without being played.

- componentId: `2060`
- commandId: `863`
- componentName: `franchisemode`

Payload:
```json
{
    "seasonGameKey": <seasonGameKey>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1787795955,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_GameSchedule_ForceHomeWin\",\"componentId\":2060,\"commandId\":863,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"seasonGameKey\\\":544735370,\\\"leagueId\\\":2890093}\",\"componentName\":\"careermode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Force Away Win
`Mobile_GameSchedule_ForceAwayWin`

Forces a scheduled game to resolve as an away team win without being played.

- componentId: `2060`
- commandId: `864`
- componentName: `franchisemode`

Payload:
```json
{
    "seasonGameKey": <seasonGameKey>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1787796015,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_GameSchedule_ForceAwayWin\",\"componentId\":2060,\"commandId\":864,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"seasonGameKey\\\":544735370,\\\"leagueId\\\":2890093}\",\"componentName\":\"careermode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Force No Win
`Mobile_GameSchedule_ForceNoWin`

Reverts/clears a forced result on a scheduled game (returns it to not-played).

- componentId: `2060`
- commandId: `865`
- componentName: `franchisemode`

Payload:
```json
{
    "seasonGameKey": <seasonGameKey>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1787796091,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_GameSchedule_ForceNoWin\",\"componentId\":2060,\"commandId\":865,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"seasonGameKey\\\":544735370,\\\"leagueId\\\":2890093}\",\"componentName\":\"careermode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Clear Cap Penalties
`Mobile_UserAdmin_ClearCapPenalties`

Clears salary cap penalties for a given user's team.

- componentId: `2050`
- commandId: `9110`
- componentName: `franchisemode`

Payload:
```json
{
    "clearedUserId": <userId>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1787796233,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_UserAdmin_ClearCapPenalties\",\"componentId\":2050,\"commandId\":9110,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"clearedUserId\\\":872284979,\\\"leagueId\\\":2890093}\",\"componentName\":\"careermode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Boot User
`Mobile_UserAdmin_BootUser`

Removes a user from the league, optionally promoting a replacement admin.

- componentId: `2060`
- commandId: `844`
- componentName: `franchisemode`

Payload:
```json
{
    "bootedUserId": <userId>,
    "newAdminUserId": <userId|null>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1788245349,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_UserAdmin_BootUser\",\"componentId\":2060,\"commandId\":844,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"bootedUserId\\\":415205964,\\\"newAdminUserId\\\":null,\\\"leagueId\\\":2282363}\",\"componentName\":\"franchisemode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Add Commissioner
`Mobile_UserAdmin_AddAdmin`

Grants commissioner/admin rights to a user.

- componentId: `2060`
- commandId: `847`
- componentName: `franchisemode`

Payload:
```json
{
    "bootedUserId": <userId|null>,
    "newAdminUserId": <userId>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1788245465,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_UserAdmin_AddAdmin\",\"componentId\":2060,\"commandId\":847,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"bootedUserId\\\":null,\\\"newAdminUserId\\\":1776476807,\\\"leagueId\\\":2282363}\",\"componentName\":\"franchisemode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Remove Commissioner
`Mobile_UserAdmin_RemoveAdmin`

Revokes commissioner/admin rights from a user.

- componentId: `2060`
- commandId: `848`
- componentName: `franchisemode`

Payload:
```json
{
    "bootedUserId": <userId|null>,
    "newAdminUserId": <userId>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1788245493,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_UserAdmin_RemoveAdmin\",\"componentId\":2060,\"commandId\":848,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"bootedUserId\\\":null,\\\"newAdminUserId\\\":1776476807,\\\"leagueId\\\":2282363}\",\"componentName\":\"franchisemode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```

---

### Transfer Commissioner
`Mobile_UserAdmin_TransferAdmin`

Transfers commissioner/admin rights to another user.

- componentId: `2060`
- commandId: `845`
- componentName: `franchisemode`

Payload:
```json
{
    "bootedUserId": <userId|null>,
    "newAdminUserId": <userId>,
    "leagueId": <leagueId>
}
```

Raw request:
```json
{
    "apiVersion": 2,
    "clientDevice": 3,
    "requestInfo": "{\"messageExpirationTime\":1788245725,\"deviceId\":\"a5fbc3ef87dcf345\",\"commandName\":\"Mobile_UserAdmin_TransferAdmin\",\"componentId\":2060,\"commandId\":845,\"ipAddress\":\"127.0.0.1\",\"requestPayload\":\"{\\\"bootedUserId\\\":null,\\\"newAdminUserId\\\":1785617209,\\\"leagueId\\\":2282363}\",\"componentName\":\"franchisemode\",\"messageAuthData\":{\"authData\":\"\",\"authCode\":\"\"}}"
}
```
