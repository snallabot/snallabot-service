export const MADDEN_SEASON = 2024

export function getMessageForWeek(week: number) {
  if (week < 1 || week > 23 || week === 22) {
    throw new Error("Invalid week number. Valid weeks are week 1-18 and for playoffs: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
  }
  if (week <= 18) {
    return `Week ${week}`
  } else if (week === 19) {
    return "Wildcard Round"
  } else if (week === 20) {
    return "Divisional Round"
  } else if (week === 21) {
    return "Conference Championship Round"
  } else if (week === 23) {
    return "Super Bowl"
  }
  throw new Error("Unknown week " + week)
}

export type Team = {
  ovrRating: number,
  injuryCount: number,
  divName: string,
  cityName: string,
  teamId: number,
  logoId: number,
  abbrName: string,
  userName: string,
  nickName: string,
  offScheme: number,
  secondaryColor: number,
  primaryColor: number,
  defScheme: number,
  displayName: string
}

export type TeamExport = {
  message: string,
  success: boolean,
  leagueTeamInfoList: Array<Team>
}

export type Standing = {
  divTies: number,
  awayLosses: number,
  seed: number,
  ptsForRank: number,
  awayWins: number,
  confWins: number,
  divisionId: number,
  defPassYdsRank: number,
  offPassYdsRank: number,
  seasonIndex: number,
  rank: number,
  defRushYds: number,
  offRushYds: number,
  totalLosses: number,
  homeLosses: number,
  conferenceId: number,
  homeWins: number,
  ptsFor: number,
  teamId: number,
  teamOvr: number,
  capAvailable: number,
  winPct: number,
  divisonName: string,
  ptsAgainst: number,
  divLosses: number,
  playoffStatus: number,
  conferenceName: string,
  awayTies: number,
  confLosses: number,
  offRushYdsRank: number,
  defRushYdsRank: number,
  prevRank: number,
  confTies: number,
  totalTies: number,
  tODiff: number,
  capRoom: number,
  offTotalYds: number,
  winLossStreak: number,
  divWins: number,
  offTotalYdsRank: number,
  teamName: string,
  homeTies: number,
  calendarYear: number,
  defTotalYds: number,
  stageIndex: number,
  netPts: number,
  ptsAgainstRank: number,
  defTotalYdsRank: number,
  capSpent: number,
  totalWins: number,
  weekIndex: number,
  defPassYds: number,
  offPassYds: number,
}

export function formatRecord(standing: Standing) {
  if (standing.totalTies === 0) {
    return `${standing.totalWins}-${standing.totalLosses}`
  }
  return `${standing.totalWins}-${standing.totalLosses}-${standing.totalTies}`
}

export type StandingExport = {
  message: string,
  success: boolean,
  teamStandingInfoList: Array<Standing>
}

export type MaddenGame = {
  status: number,
  awayScore: number,
  awayTeamId: number,
  weekIndex: number,
  homeScore: number,
  homeTeamId: number,
  scheduleId: number,
  seasonIndex: number,
  isGameOfTheWeek: boolean,
  stageIndex: number
}

export type SchedulesExport = {
  success: boolean,
  message: string,
  gameScheduleInfoList: Array<MaddenGame>
}

export type PuntingStats = {
  puntsIn20: number,
  stageIndex: number,
  puntNetYds: number,
  statId: number,
  puntTBs: number,
  teamId: number,
  seasonIndex: number,
  puntLongest: number,
  rosterId: number,
  weekIndex: number,
  fullName: string,
  puntAtt: number,
  scheduleId: number,
  puntYds: number,
  puntsBlocked: number,
  puntNetYdsPerAtt: number,
  puntYdsPerAtt: number
}

export type PuntingExport = {
  success: boolean,
  message: string,
  playerPuntingStatInfoList: Array<PuntingStats>
}


export type TeamStats = {
  teamId: number,
  totalWins: number,
  defRedZoneFGs: number,
  seed: number,
  off2PtConv: number,
  off2PtConvPct: number,
  offPassYds: number,
  defRedZonePct: number,
  offPtsPerGame: number,
  offFumLost: number,
  totalLosses: number,
  defPassYds: number,
  offRushTds: number,
  defRedZones: number,
  tODiff: number,
  offTotalYds: number,
  off4thDownConvPct: number,
  penaltyYds: number,
  statId: number,
  totalTies: number,
  off3rdDownConvPct: number,
  off3rdDownAtt: number,
  off1stDowns: number,
  offRedZoneTDs: number,
  off2PtAtt: number,
  offRushYds: number,
  defFumRec: number,
  defPtsPerGame: number,
  weekIndex: number,
  offRedZoneFGs: number,
  offTotalYdsGained: number,
  defRushYds: number,
  tOTakeaways: number,
  offSacks: number,
  defIntsRec: number,
  off4thDownAtt: number,
  offIntsLost: number,
  off4thDownConv: number,
  offRedZones: number,
  scheduleId: number,
  defForcedFum: number,
  defSacks: number,
  defRedZoneTDs: number,
  offRedZonePct: number,
  offPassTDs: number,
  defTotalYds: number,
  off3rdDownConv: number,
  penalties: number,
  seasonIndex: number,
  stageIndex: number,
  tOGiveaways: number
}

export type TeamStatsExport = {
  success: boolean,
  message: string,
  teamStatInfoList: Array<TeamStats>
}

export type PassingStats = {
  fullName: string,
  passerRating: number,
  passYds: number,
  passYdsPerGame: number,
  passCompPct: number,
  rosterId: number,
  passYdsPerAtt: number,
  passComp: number,
  scheduleId: number,
  passPts: number,
  weekIndex: number,
  seasonIndex: number,
  passLongest: number,
  passSacks: number,
  stageIndex: number,
  teamId: number,
  passInts: number,
  passAtt: number,
  passTDs: number,
  statId: number
}

export type PassingExport = {
  success: boolean,
  message: string,
  playerPassingStatInfoList: Array<PassingStats>
}

export type KickingStats = {
  fGMade: number,
  fGAtt: number,
  rosterId: number,
  kickPts: number,
  xPCompPct: number,
  fGCompPct: number,
  fG50PlusAtt: number,
  fG50PlusMade: number,
  scheduleId: number,
  weekIndex: number,
  seasonIndex: number,
  kickoffAtt: number,
  kickoffTBs: number,
  fGLongest: number,
  xPMade: number,
  xPAtt: number,
  stageIndex: number,
  teamId: number,
  fullName: string,
  statId: number
}

export type KickingExport = {
  success: boolean,
  message: string,
  playerKickingStatInfoList: Array<KickingStats>
}

export type RushingStats = {
  rosterId: number,
  rushBrokenTackles: number,
  rushYdsPerGame: number,
  rushPts: number,
  scheduleId: number,
  rushToPct: number,
  rushLongest: number,
  weekIndex: number,
  seasonIndex: number,
  rushYdsPerAtt: number,
  rushYdsAfterContact: number,
  rushAtt: number,
  stageIndex: number,
  rushTDs: number,
  teamId: number,
  rush20PlusYds: number,
  rushFum: number,
  rushYds: number,
  fullName: string,
  statId: number
}

export type RushingExport = {
  success: boolean,
  message: string,
  playerRushingStatInfoList: Array<RushingStats>
}

export type DefensiveStats = {
  defInts: number,
  stageIndex: number,
  statId: number,
  defPts: number,
  defFumRec: number,
  defDeflections: number,
  seasonIndex: number,
  defSacks: number,
  teamId: number,
  defTDs: number,
  defSafeties: number,
  fullName: string,
  defTotalTackles: number,
  rosterId: number,
  scheduleId: number,
  weekIndex: number,
  defCatchAllowed: number,
  defIntReturnYds: number,
  defForcedFum: number
}

export type DefensiveExport = {
  success: boolean,
  message: string,
  playerDefensiveStatInfoList: Array<DefensiveStats>
}

export type ReceivingStats = {
  rosterId: number,
  recPts: number,
  recDrops: number,
  scheduleId: number,
  recYacPerCatch: number,
  recTDs: number,
  recYdsPerGame: number,
  weekIndex: number,
  recYds: number,
  seasonIndex: number,
  recCatchPct: number,
  recCatches: number,
  teamId: number,
  stageIndex: number,
  recLongest: number,
  recYdsPerCatch: number,
  recToPct: number,
  recYdsAfterCatch: number,
  fullName: string,
  statId: number
}

export type ReceivingExport = {
  success: boolean,
  message: string,
  playerReceivingStatInfoList: Array<ReceivingStats>
}

export type Ability = {
  locked: boolean,
  ovrThreshold: number,
  signatureAbility: {
    signatureLogoId: number,
    marketplaceAbilityAlias: string,
    signatureDeactivationDescription: string,
    activationEnabled: boolean,
    unlockRequirement: string,
    deactivationEnabled: boolean,
    signatureTitle: string,
    signatureActivationDescription: string,
    activationId: string,
    deactivationId: string,
    startActivated: boolean,
    isUnlocked: boolean,
    abilityGUID: string,
    abilityRank: string,
    isPassive: boolean,
    signatureDescription: string
  },
  isEmpty: boolean

}

export type Player = {
  rookieYear: number,
  throwOnRunRating: number,
  powerMovesRating: number,
  dropOpenPassTrait: number,
  hPCatchTrait: number,
  kickAccRating: number,
  dLSpinTrait: number,
  runBlockFinesseRating: number,
  throwPowerRating: number,
  forcePassTrait: number,
  homeState: number,
  agilityRating: number,
  posCatchTrait: number,
  hitPowerRating: number,
  legacyScore: number,
  throwAccShortRating: number,
  stiffArmRating: number,
  routeRunShortRating: number,
  feetInBoundsTrait: number,
  pressRating: number,
  height: number,
  rosterId: number,
  injuryLength: number,
  injuryType: number,
  pursuitRating: number,
  leadBlockRating: number,
  confRating: number,
  breakTackleRating: number,
  jukeMoveRating: number,
  throwAccDeepRating: number,
  dLBullRushTrait: number,
  dLSwimTrait: number,
  capReleasePenalty: number,
  devTrait: number,
  catchRating: number,
  capHit: number,
  lastName: string,
  age: number,
  staminaRating: number,
  contractBonus: number,
  strengthRating: number,
  contractLength: number,
  desiredLength: number,
  sensePressureTrait: number,
  bigHitTrait: number,
  passBlockFinesseRating: number,
  awareRating: number,
  isFreeAgent: boolean,
  runBlockPowerRating: number,
  capReleaseNetSavings: number,
  highMotorTrait: number,
  routeRunMedRating: number,
  productionGrade: number,
  tackleRating: number,
  throwAwayTrait: number,
  experiencePoints: number,
  bCVRating: number,
  sizeGrade: number,
  isOnIR: boolean,
  contractSalary: number,
  runBlockRating: number,
  durabilityGrade: number,
  birthDay: number,
  coverBallTrait: number,
  skillPoints: number,
  predictTrait: number,
  teamSchemeOvr: number,
  playBallTrait: number,
  birthMonth: number,
  kickPowerRating: number,
  jumpRating: number,
  playActionRating: number,
  toughRating: number,
  physicalGrade: number,
  desiredBonus: number,
  homeTown: string,
  desiredSalary: number,
  passBlockRating: number,
  passBlockPowerRating: number,
  isOnPracticeSquad: false,
  finesseMovesRating: number,
  specCatchRating: number,
  tightSpiralTrait: number,
  manCoverRating: number,
  draftPick: number,
  zoneCoverRating: number,
  birthYear: number,
  carryRating: number,
  weight: number,
  reSignStatus: number,
  intangibleGrade: number,
  teamId: number,
  speedRating: number,
  breakSackRating: number,
  yACCatchTrait: number,
  runStyle: number,
  portraitId: number,
  college: string,
  firstName: string,
  impactBlockRating: number,
  draftRound: number,
  changeOfDirectionRating: number,
  truckRating: number,
  jerseyNum: number,
  blockShedRating: number,
  throwUnderPressureRating: number,
  yearsPro: number,
  spinMoveRating: number,
  clutchTrait: number,
  releaseRating: number,
  rosterGoalList: [],
  penaltyTrait: number,
  stripBallTrait: number,
  qBStyleTrait: number,
  position: string,
  injuryRating: number,
  fightForYardsTrait: number,
  signatureSlotList: Array<Ability>,
  accelRating: number,
  playerSchemeOvr: number,
  throwAccRating: number,
  kickRetRating: number,
  playerBestOvr: number,
  presentationId: number,
  playRecRating: number,
  scheme: number,
  lBStyleTrait: number,
  throwAccMidRating: number,
  contractYearsLeft: number,
  routeRunDeepRating: number,
  isActive: boolean,
  cITRating: number
}

export type RosterExport = {
  success: boolean,
  message: string,
  rosterInfoList: Array<Player>
}
