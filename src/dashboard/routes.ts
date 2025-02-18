import Router from "@koa/router"
import Pug from "pug"
import path from "path"
import { Next, ParameterizedContext } from "koa"

const startRender = Pug.compileFile(path.join(__dirname, "/templates/start.pug"))
const errorRender = Pug.compileFile(path.join(__dirname, "/templates/error.pug"))
const personaRender = Pug.compileFile(path.join(__dirname, "/templates/persona.pug"))

const router = new Router({ prefix: "/dashboard" })

export const AUTH_SOURCE = 317239
export const CLIENT_SECRET = "wfGAWnrxLroZOwwELYA2ZrAuaycuF2WDb00zOLv48Sb79viJDGlyD6OyK8pM5eIiv_20240731135155"
export const REDIRECT_URL = "http://127.0.0.1/success"
export const CLIENT_ID = "MCA_25_COMP_APP"
export const MACHINE_KEY = "444d362e8e067fe2"
export const EA_LOGIN_URL = `https://accounts.ea.com/connect/auth?hide_create=true&release_type=prod&response_type=code&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}&machineProfileKey=${MACHINE_KEY}&authentication_source=${AUTH_SOURCE}`

export const TWO_DIGIT_YEAR = "25"
export const YEAR = "2025"

export const VALID_ENTITLEMENTS = ((a: string) => ({
  xone: `MADDEN_${a}XONE`,
  ps4: `MADDEN_${a}PS4`,
  pc: `MADDEN_${a}PC`,
  ps5: `MADDEN_${a}PS5`,
  xbsx: `MADDEN_${a}XBSX`,
  stadia: `MADDEN_${a}SDA`,
}))(TWO_DIGIT_YEAR)

export const ENTITLEMENT_TO_SYSTEM = ((a: string) => ({
  [`MADDEN_${a}XONE`]: "xone",
  [`MADDEN_${a}PS4`]: "ps4",
  [`MADDEN_${a}PC`]: "pc",
  [`MADDEN_${a}PS5`]: "ps5",
  [`MADDEN_${a}XBSX`]: "xbsx",
  [`MADDEN_${a}SDA`]: "stadia",
}))(TWO_DIGIT_YEAR)

const ENTITLEMENT_TO_VALID_NAMESPACE = (a: string) => ({
  [`MADDEN_${a}XONE`]: "xbox",
  [`MADDEN_${a}PS4`]: "ps3",
  [`MADDEN_${a}PC`]: "cem_ea_id",
  [`MADDEN_${a}PS5`]: "ps3",
  [`MADDEN_${a}XBSX`]: "xbox",
  [`MADDEN_${a}SDA`]: "stadia",
})

export const SYSTEM_MAP = (a: string) => ({
  xone: `MADDEN_${a}_XONE_BLZ_SERVER`,
  ps4: `MADDEN_${a}_PS4_BLZ_SERVER`,
  pc: `MADDEN_${a}_PC_BLZ_SERVER`,
  ps5: `MADDEN_${a}_PS5_BLZ_SERVER`,
  xbsx: `MADDEN_${a}_XBSX_BLZ_SERVER`,
  stadia: `MADDEN_${a}_SDA_BLZ_SERVER`,
})

const namespaces = {
  xbox: "XBOX",
  ps3: "PSN",
  cem_ea_id: "EA Account",
  stadia: "Stadia",
}

/*
  I want to document the response types from EA. Some of these should be more narrowly defined, but I do not know what all the enumerations are. I welcome in the future if we find more values that we change these to be narrower so we can safely rely on the values better
*/
export type AccountToken = { access_token: string; expires_in: number; id_token: null; refresh_token: string; token_type: "Bearer" }
export type TokenInfo = { client_id: "MCA_25_COMP_APP"; expires_in: number; persona_id: null; pid_id: string; pid_type: "NUCLEUS"; scope: string; user_id: string }
export type Entitlement = { entitlementId: number; entitlementSource: string; entitlementTag: string; entitlementType: string; grantDate: string; groupName: string; isConsumable: boolean; lastModifiedDate: string; originPermissions: number; pidUri: string; productCatalog: string; productId: string; projectId: string; status: string; statusReasonCode: string; terminationDate: string; useCount: number; version: number }
export type Entitlements = { entitlements: { entitlement: Array<Entitlement> } }
export type Namespace = "xbox" | "ps3" | "cem_ea_id" | "stadia"
export type SystemConsole = "xone" | "xbsx" | "ps4" | "ps5" | "pc" | "stadia"
export type Persona = { dateCreated: string; displayName: string; isVisible: boolean; lastAuthenticated: string; name: string; namespaceName: Namespace; personaId: number; pidId: number; showPersona: string; status: string; statusReasonCode: string }
export type Personas = { personas: { persona: Array<Persona> } }

export class EAAccountError extends Error {
  troubleshoot: string

  constructor(message: string, troubleshoot: string) {
    super(message)
    this.name = "EAAccountError"
    this.troubleshoot = troubleshoot
  }
}


type RetrievePersonasRequest = { code: string }
type LinkPersona = { selected_persona: string, access_token: string }
type RetrievePersonaInformationRequest = { persona_id: number | undefined, session_id: string | undefined }

async function renderErrorsMiddleware(ctx: ParameterizedContext, next: Next) {
  try {
    await next()
  } catch (e) {
    if (e instanceof EAAccountError) {
      const error = `Error receieved from EA <br> Message: ${e.message} <br> Snallabot Guidance: ${e.troubleshoot}`
      ctx.body = errorRender({ error: error })
    } else {
      const error = `Error receieved from Dashboard <br> Message: ${e}`
      ctx.body = errorRender({ error: error })
    }
  }
}

router.get("/", (ctx) => {
  ctx.body = startRender({ url: EA_LOGIN_URL })
}).post("/retrievePersonas", renderErrorsMiddleware, async (ctx, next) => {
  const { code: rawCode } = ctx.request.body as RetrievePersonasRequest
  const searchParams = rawCode.substring(rawCode.indexOf("?"))
  const eaCodeParams = new URLSearchParams(searchParams)
  const code = eaCodeParams.get("code")
  if (!code) {
    throw new Error(`invalid code URL sent. Expected format is http://127.0.0.1/success?code=CODE Actual url sent ${rawCode}`)
  }
  const response = await fetch("https://accounts.ea.com/connect/token", {
    method: "POST",
    headers: {
      "Accept-Charset": "UTF-8",
      "User-Agent":
        "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept-Encoding": "gzip",
    },
    body: `authentication_source=${AUTH_SOURCE}&client_secret=${CLIENT_SECRET}&grant_type=authorization_code&code=${code}&redirect_uri=${REDIRECT_URL}&release_type=prod&client_id=${CLIENT_ID}`
  })
  if (!response.ok) {
    const errorResponse = await response.text()
    throw new EAAccountError(`Failed to use login code: ${errorResponse}`, `This may have happened because the EA url used to login has been used already. Each time you copy and paste the URL it is valid only for one use only. Try to go back to the previous page and login again`)
  }
  const { access_token } = (await response.json()) as AccountToken

  const pidResponse = await fetch(
    `https://accounts.ea.com/connect/tokeninfo?access_token=${access_token}`,
    {
      headers: {
        "Accept-Charset": "UTF-8",
        "X-Include-Deviceid": "true",
        "User-Agent":
          "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
        "Accept-Encoding": "gzip",
      },
    }
  )
  if (!pidResponse.ok) {
    const errorResponse = await response.text()
    throw new EAAccountError(`Failed to retrieve account information: ${errorResponse}`, "No Guidance")
  }
  const { pid_id: pid } = (await pidResponse.json()) as TokenInfo
  const pidUriResponse = await fetch(
    `https://gateway.ea.com/proxy/identity/pids/${pid}/entitlements/?status=ACTIVE`,
    {
      headers: {
        "User-Agent":
          "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
        "Accept-Charset": "UFT-8",
        "X-Expand-Results": "true",
        "Accept-Encoding": "gzip",
        Authorization: `Bearer ${access_token}`,
      },
    }
  )
  if (!pidUriResponse.ok) {
    const errorResponse = await response.text()
    throw new EAAccountError(`Failed to retrieve madden entitlements: ${errorResponse}`, `This may happen because the EA account used to login is not the right one or is not connected to Madden. One way to fix this is to try connecting this EA account to your Madden one, or checking if it is the right one. You can do this at this at this link <a href="https://myaccount.ea.com/cp-ui/connectaccounts/index" target="_blank">https://myaccount.ea.com/cp-ui/connectaccounts/index</a>`)
  }
  const { entitlements: { entitlement: userEntitlements } } = (await pidUriResponse.json()) as Entitlements
  const validEntitlements = userEntitlements.filter(e => e.entitlementTag === "ONLINE_ACCESS" && Object.values(VALID_ENTITLEMENTS).includes(e.groupName))
  if (validEntitlements.length === 0) {
    throw new EAAccountError("User cannot access this version of Madden!", `This may happen because the EA account used to login is not the right one or is not connected to Madden. One way to fix this is to try connecting this EA account to your Madden one, or checking if it is the right one. You can do this at this at this link <a href="https://myaccount.ea.com/cp-ui/connectaccounts/index" target="_blank">https://myaccount.ea.com/cp-ui/connectaccounts/index</a>`)
  }
  const retrievedPersonas = await Promise.all(validEntitlements.map(async e => {
    const { pidUri, groupName: maddenEntitlement } = e
    const personasResponse = await fetch(
      `https://gateway.ea.com/proxy/identity${pidUri}/personas?status=ACTIVE&access_token=${access_token}`,
      {
        headers: {
          "Acccept-Charset": "UTF-8",
          "X-Expand-Results": "true",
          "User-Agent":
            "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
          "Accept-Encoding": "gzip",
        },
      }
    )
    if (!personasResponse.ok) {
      const errorResponse = await response.text()
      throw new EAAccountError(`Failed to retrieve madden persona accounts: ${errorResponse}`, `No Help Found`)
    }
    const { personas: { persona: userEaPersonas } } = (await personasResponse.json()) as Personas
    return userEaPersonas.map(p => ({ ...p, maddenEntitlement }))
  }))
  const finalPersonas = retrievedPersonas.flat().filter(p => ENTITLEMENT_TO_VALID_NAMESPACE(TWO_DIGIT_YEAR)[p.maddenEntitlement] === p.namespaceName)
  if (finalPersonas.length === 0) {
    throw new EAAccountError("There are no Madden accounts associated with this EA account!", `This may happen because the EA account used to login is not the right one or is not connected to Madden. One potential fix is to try connecting this EA account to your Madden one, or checking if it is the right one. You can do this at this at this link <a href="https://myaccount.ea.com/cp-ui/connectaccounts/index" target="_blank">https://myaccount.ea.com/cp-ui/connectaccounts/index</a>`)
  }
  ctx.body = personaRender({ personas: finalPersonas, namespaces: namespaces, access_token })
})
  .post("/selectedPersona", renderErrorsMiddleware, async (ctx, next) => {
    ctx.body = ctx.request.body
    const { selected_persona, access_token } = ctx.request.body as LinkPersona
    const persona = JSON.parse(selected_persona) as Persona
    const locationUrlResponse = await fetch(`https://accounts.ea.com/connect/auth?hide_create=true&release_type=prod&response_type=code&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}&machineProfileKey=${MACHINE_KEY}&authentication_source=${AUTH_SOURCE}&access_token=${access_token}&persona_id=${persona.personaId}&persona_namespace=${persona.namespaceName}`, {
      redirect: "manual", // this fetch resolves to localhost address with a code as a query string. if we follow the redirect, it won't be able to connect. Just take the location from the manual redirect
      headers: {
        "Upgrade-Insecure-Requests": "1",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.71 Mobile Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        "X-Requested-With": "com.ea.gp.madden19companionapp",
        "Sec-Fetc-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "en-US,en;q=0,9",
      }
    })

    const locationUrl = locationUrlResponse.headers.get("Location")
    if (!locationUrl) {
      throw new EAAccountError("Tried to retrieve location of access token but failed!", "No Guidance")
    }

    const eaCode = new URLSearchParams(locationUrl.replace(REDIRECT_URL, "")).get("code")
    if (!eaCode) {
      console.error(`Could not retrieve code from ${locationUrl}`)
      throw new EAAccountError("Tried to retrieve new access token but failed!", "No Guidance")
    }
    const newAccessTokenResponse = await fetch(`https://accounts.ea.com/connect/token`, {
      method: "POST",
      headers: {
        "Accept-Charset": "UTF-8",
        "User-Agent":
          "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept-Encoding": "gzip",
      },
      body: `authentication_source=${AUTH_SOURCE}&code=${eaCode}&grant_type=authorization_code&token_format=JWS&release_type=prod&client_secret=${CLIENT_SECRET}&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}`,
    })
    if (!newAccessTokenResponse.ok) {
      const errorResponse = await newAccessTokenResponse.text()
      throw new EAAccountError(`Failed to create access token: ${errorResponse}`, "No Guidance")
    }
    const token = (await newAccessTokenResponse.json()) as AccountToken
    ctx.body = token
  })
// .post("/retrievePersonaInformation", async (ctx, next) => {
//   const retrievePersonaReq = ctx.request.body as RetrievePersonaInformationRequest
//   let personaId;
//   if (retrievePersonaReq.session_id) {
//     const session = await UserDB.retrieveSession(retrievePersonaReq.session_id)
//     personaId = session.personaId
//   } else if (retrievePersonaReq.persona_id) {
//     personaId = retrievePersonaReq.persona_id
//   } else {
//     throw new InvalidRequestError("Need to provide either session_id or persona_id")
//   }
//   const persona = await UserDB.retrievePersona(personaId)
//   ctx.body = persona
//   await next()
// })

export default router
