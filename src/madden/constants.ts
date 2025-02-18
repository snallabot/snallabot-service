export const AUTH_SOURCE = 317239
export const CLIENT_SECRET = "U02zL2khwlgFdODLWCyLPmccOc5EiPBBYcEwCqKDTWBrZj2Fwcx4b4Zd9rsA6lHLkIU4qlVvNh84oli"
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

export const ENTITLEMENT_TO_SYSTEM = ((a) => ({
  [`MADDEN_${a}XONE`]: "xone",
  [`MADDEN_${a}PS4`]: "ps4",
  [`MADDEN_${a}PC`]: "pc",
  [`MADDEN_${a}PS5`]: "ps5",
  [`MADDEN_${a}XBSX`]: "xbsx",
  [`MADDEN_${a}SDA`]: "stadia",
}))(TWO_DIGIT_YEAR)

export const SYSTEM_MAP = (a: string) => ({
  xone: `MADDEN_${a}_XONE_BLZ_SERVER`,
  ps4: `MADDEN_${a}_PS4_BLZ_SERVER`,
  pc: `MADDEN_${a}_PC_BLZ_SERVER`,
  ps5: `MADDEN_${a}_PS5_BLZ_SERVER`,
  xbsx: `MADDEN_${a}_XBSX_BLZ_SERVER`,
  stadia: `MADDEN_${a}_SDA_BLZ_SERVER`,
})
