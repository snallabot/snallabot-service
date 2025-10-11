# EA API Documentation

This documents every endpoint known from reverse engineering the Companion App. These calls must be done in order. 

Step 1: A user must login to EA via this url:

This is all the parts to it
```
const AUTH_SOURCE = 317239
const CLIENT_SECRET = "wfGAWnrxLroZOwwELYA2ZrAuaycuF2WDb00zOLv48Sb79viJDGlyD6OyK8pM5eIiv_20240731135155"
const REDIRECT_URL = "http://127.0.0.1/success"
const CLIENT_ID = "MCA_25_COMP_APP"
const MACHINE_KEY = "444d362e8e067fe2"
const EA_LOGIN_URL = `https://accounts.ea.com/connect/auth?hide_create=true&release_type=prod&response_type=code&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}&machineProfileKey=${MACHINE_KEY}&authentication_source=${AUTH_SOURCE}`
```

This is the final url
```
https://accounts.ea.com/connect/auth?hide_create=true&release_type=prod&response_type=code&redirect_uri=http://127.0.0.1/success&client_id=MCA_25_COMP_APP&machineProfileKey=444d362e8e067fe2&authentication_source=317239
```

Saving it with the parts is better because very year those are the values that can change. Now, once the user logins they will be redirects to a url that looks like

```
http://127.0.0.1/success?code=QUOhAFs1kcSeHLr18VvFW70-6zD7LwCOe_itdEp5
```
That code is used in the next step. 

## Retrieve Personas

Step 1 - Retrieve an accounts EA persona. This is their EA account and has the connections to Madden

```
https://accounts.ea.com/connect/token
method: POST
body: authentication_source=${AUTH_SOURCE}&client_secret=${CLIENT_SECRET}&grant_type=authorization_code&code=${code}&redirect_uri=${REDIRECT_URL}&release_type=prod&client_id=${CLIENT_ID}
headers: 
      "Accept-Charset": "UTF-8",
      "User-Agent":
        "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept-Encoding": "gzip",
```
Please use these headers exactly (as it emulates a device better)



## League API

coming soon...

GetLeagues

[Example Response](./api_data/get_leagues.json)

GetLeague

[Example Response](./api_data/get_league.json)
