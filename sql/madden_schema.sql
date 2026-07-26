-- Madden data schema (Postgres)
--
-- Scope: only the madden_data26 tree (teams, standings, schedule, stats, players).
-- League metadata / blaze_id / discord settings / export status stay in Firestore for now.
--
-- Conventions:
--   - league_id is a plain TEXT column, not a FK (the league record lives in Firestore).
--   - Every "latest state" table has a companion `_history` table with identical columns
--     (via LIKE) plus history_id/recorded_at. If you ALTER a main table, mirror the
--     change onto its _history table in the same migration - they are not kept in sync
--     automatically.
--   - 0-99 rating/grade fields and small ranks/enums use SMALLINT (2 bytes).
--     Season/cumulative yardage, points, and cap-dollar fields use INTEGER (4 bytes).
--     True fractional fields (percentages, pcts) use REAL.
--   - `rosterGoalList` from the Player export is always an empty array in practice (typed
--     as `[]` in madden_league_types.ts) - intentionally not mapped to a column.
--
-- Player identity (the important part):
--   Madden reassigns rosterId on title updates, so rosterId is NOT a stable identity for
--   a real player over a league's lifetime. The app already treats
--   (presentationId, birthYear, birthMonth, birthDay) as the true identity
--   (see createPlayerKey() in madden_db.ts) and does read-time dedup across old rosterId
--   docs to cope with this in Firestore. Here that's fixed at the storage layer instead:
--     - madden_players is keyed by the stable identity, not roster_id. A title update
--       UPDATEs the existing row's roster_id column in place instead of creating a new row.
--     - player_identity_map remembers every roster_id ever seen -> which identity it
--       belongs to, so historical stat rows (which only ever carried a roster_id from EA)
--       can still be resolved to the right player after their roster_id has moved on.
--     - stat tables keep only roster_id (as EA sends it); identity is resolved at READ
--       time via a JOIN against player_identity_map instead of being denormalized at
--       write time. "All stats for this player" becomes one indexed join instead of the
--       current multi-rosterId query-then-merge dance in getPlayerStats/deduplicatePlayerStats.

-- =====================================================================
-- MADDEN_TEAM  (doc id = teamId)
-- =====================================================================
CREATE TABLE madden_teams (
  league_id        TEXT NOT NULL,
  team_id          INTEGER NOT NULL,
  platform         TEXT,                 -- written, currently never read; droppable
  ovr_rating       SMALLINT,
  injury_count     SMALLINT,
  div_name         TEXT,
  city_name        TEXT,
  logo_id          INTEGER,
  abbr_name        TEXT,
  user_name        TEXT,
  nick_name        TEXT,
  off_scheme       SMALLINT,
  secondary_color  INTEGER,
  primary_color    INTEGER,
  def_scheme       SMALLINT,
  display_name     TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, team_id)
);

CREATE TABLE madden_teams_history (LIKE madden_teams INCLUDING DEFAULTS);
ALTER TABLE madden_teams_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- =====================================================================
-- MADDEN_STANDING  (doc id = teamId; season/week are payload fields, not part of the key -
-- only the current standing is "latest", prior seasons live in history)
-- =====================================================================
CREATE TABLE madden_standings (
  league_id             TEXT NOT NULL,
  team_id               INTEGER NOT NULL,
  platform              TEXT,
  season_index          SMALLINT,
  week_index            SMALLINT,
  stage_index           SMALLINT,
  calendar_year         SMALLINT,
  rank                  SMALLINT,
  prev_rank             SMALLINT,
  seed                  SMALLINT,
  division_id           SMALLINT,
  division_name         TEXT,
  conference_id         SMALLINT,
  conference_name       TEXT,
  playoff_status        SMALLINT,
  team_name             TEXT,
  team_ovr              SMALLINT,
  total_wins            SMALLINT,
  total_losses          SMALLINT,
  total_ties            SMALLINT,
  home_wins             SMALLINT,
  home_losses           SMALLINT,
  home_ties             SMALLINT,
  away_wins             SMALLINT,
  away_losses           SMALLINT,
  away_ties             SMALLINT,
  div_wins              SMALLINT,
  div_losses            SMALLINT,
  div_ties              SMALLINT,
  conf_wins             SMALLINT,
  conf_losses           SMALLINT,
  conf_ties             SMALLINT,
  win_pct               REAL,
  win_loss_streak       SMALLINT,
  pts_for               INTEGER,
  pts_for_rank          SMALLINT,
  pts_against           INTEGER,
  pts_against_rank      SMALLINT,
  net_pts               INTEGER,
  off_total_yds         INTEGER,
  off_total_yds_rank    SMALLINT,
  off_pass_yds          INTEGER,
  off_pass_yds_rank     SMALLINT,
  off_rush_yds          INTEGER,
  off_rush_yds_rank     SMALLINT,
  def_total_yds         INTEGER,
  def_total_yds_rank    SMALLINT,
  def_pass_yds          INTEGER,
  def_pass_yds_rank     SMALLINT,
  def_rush_yds          INTEGER,
  def_rush_yds_rank     SMALLINT,
  to_diff               SMALLINT,
  cap_available         INTEGER,
  cap_room              INTEGER,
  cap_spent             INTEGER,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, team_id)
);

CREATE TABLE madden_standings_history (LIKE madden_standings INCLUDING DEFAULTS);
ALTER TABLE madden_standings_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- =====================================================================
-- MADDEN_SCHEDULE  (doc id = season${seasonIndex}-week${weekIndex}-${scheduleId})
-- =====================================================================
CREATE TABLE madden_schedules (
  league_id            TEXT NOT NULL,
  season_index         SMALLINT NOT NULL,
  week_index           SMALLINT NOT NULL,
  schedule_id          INTEGER NOT NULL,
  platform             TEXT,
  stage_index          SMALLINT,
  status               SMALLINT,       -- GameResult enum
  home_team_id         INTEGER,
  away_team_id         INTEGER,
  home_score           SMALLINT,
  away_score           SMALLINT,
  is_game_of_the_week  BOOLEAN,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, schedule_id)
);
CREATE INDEX idx_schedules_week ON madden_schedules (league_id, week_index, season_index);

CREATE TABLE madden_schedules_history (LIKE madden_schedules INCLUDING DEFAULTS);
ALTER TABLE madden_schedules_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- =====================================================================
-- Player identity resolution
-- =====================================================================

-- The stable identity for a real player, matching createPlayerKey() in madden_db.ts.
-- madden_players is keyed by this, NOT roster_id (Madden reassigns roster_id on title
-- updates - see header note above).
--
-- MADDEN_PLAYER  (Firestore doc id = rosterId; here PK = stable identity instead)
CREATE TABLE madden_players (
  league_id         TEXT NOT NULL,
  presentation_id   INTEGER NOT NULL,
  birth_year        SMALLINT NOT NULL,
  birth_month       SMALLINT NOT NULL,
  birth_day         SMALLINT NOT NULL,
  roster_id         INTEGER,            -- current roster_id; changes in place across title updates
  platform          TEXT,
  team_id           INTEGER,
  first_name        TEXT,
  last_name         TEXT,
  position          TEXT,
  jersey_num        SMALLINT,
  age               SMALLINT,
  height            SMALLINT,
  weight            SMALLINT,
  college            TEXT,
  home_town          TEXT,
  home_state         SMALLINT,
  years_pro          SMALLINT,
  rookie_year        SMALLINT,
  draft_round        SMALLINT,
  draft_pick         SMALLINT,
  is_free_agent      BOOLEAN,
  is_active          BOOLEAN,
  is_on_practice_squad BOOLEAN,
  is_on_ir           BOOLEAN,
  re_sign_status     SMALLINT,
  dev_trait          SMALLINT,
  scheme             SMALLINT,
  team_scheme_ovr    SMALLINT,
  player_scheme_ovr  SMALLINT,
  player_best_ovr    SMALLINT,
  legacy_score       INTEGER,
  experience_points  INTEGER,
  skill_points       INTEGER,
  production_grade   REAL,
  durability_grade   REAL,
  physical_grade     REAL,
  intangible_grade   REAL,
  size_grade         REAL,
  contract_salary    INTEGER,
  contract_bonus     INTEGER,
  contract_length    SMALLINT,
  contract_years_left SMALLINT,
  cap_hit            INTEGER,
  cap_release_penalty INTEGER,
  cap_release_net_savings INTEGER,
  desired_salary     INTEGER,
  desired_bonus      INTEGER,
  desired_length     SMALLINT,
  injury_type        SMALLINT,
  injury_length      SMALLINT,
  injury_rating      SMALLINT,
  run_style          SMALLINT,
  -- 0-99 ratings
  aware_rating         SMALLINT,
  speed_rating         SMALLINT,
  accel_rating         SMALLINT,
  agility_rating       SMALLINT,
  strength_rating      SMALLINT,
  stamina_rating       SMALLINT,
  tough_rating         SMALLINT,
  jump_rating          SMALLINT,
  cit_rating           SMALLINT,
  throw_power_rating       SMALLINT,
  throw_acc_rating         SMALLINT,
  throw_acc_short_rating   SMALLINT,
  throw_acc_mid_rating     SMALLINT,
  throw_acc_deep_rating    SMALLINT,
  throw_on_run_rating      SMALLINT,
  throw_under_pressure_rating SMALLINT,
  play_action_rating       SMALLINT,
  break_sack_rating        SMALLINT,
  carry_rating         SMALLINT,
  break_tackle_rating  SMALLINT,
  truck_rating         SMALLINT,
  stiff_arm_rating     SMALLINT,
  spin_move_rating     SMALLINT,
  juke_move_rating     SMALLINT,
  bcv_rating           SMALLINT,
  catch_rating         SMALLINT,
  spec_catch_rating    SMALLINT,
  route_run_short_rating  SMALLINT,
  route_run_med_rating    SMALLINT,
  route_run_deep_rating   SMALLINT,
  release_rating          SMALLINT,
  kick_power_rating    SMALLINT,
  kick_acc_rating      SMALLINT,
  kick_ret_rating      SMALLINT,
  pass_block_rating        SMALLINT,
  pass_block_power_rating  SMALLINT,
  pass_block_finesse_rating SMALLINT,
  run_block_rating          SMALLINT,
  run_block_power_rating    SMALLINT,
  run_block_finesse_rating  SMALLINT,
  lead_block_rating         SMALLINT,
  impact_block_rating       SMALLINT,
  tackle_rating         SMALLINT,
  hit_power_rating      SMALLINT,
  pursuit_rating        SMALLINT,
  play_rec_rating       SMALLINT,
  press_rating          SMALLINT,
  man_cover_rating      SMALLINT,
  zone_cover_rating     SMALLINT,
  block_shed_rating     SMALLINT,
  power_moves_rating    SMALLINT,
  finesse_moves_rating  SMALLINT,
  change_of_direction_rating SMALLINT,
  long_snap_rating      SMALLINT,
  -- traits
  sense_pressure_trait   SMALLINT,   -- 5-value enum
  penalty_trait          SMALLINT,   -- 3-value enum
  play_ball_trait         SMALLINT,  -- 3-value enum
  cover_ball_trait        SMALLINT,  -- 5-value enum
  qb_style_trait          SMALLINT,  -- 3-value enum
  lb_style_trait           SMALLINT, -- 3-value enum
  big_hit_trait           BOOLEAN,
  strip_ball_trait        BOOLEAN,
  high_motor_trait        BOOLEAN,
  clutch_trait            BOOLEAN,
  throw_away_trait        BOOLEAN,
  tight_spiral_trait      BOOLEAN,
  fight_for_yards_trait   BOOLEAN,
  predict_trait           BOOLEAN,
  dl_swim_trait           BOOLEAN,
  dl_spin_trait           BOOLEAN,
  dl_bull_rush_trait      BOOLEAN,
  feet_in_bounds_trait    BOOLEAN,
  pos_catch_trait         BOOLEAN,
  hp_catch_trait          BOOLEAN,
  drop_open_pass_trait    BOOLEAN,
  yac_catch_trait         BOOLEAN,
  -- signature/X-Factor abilities: sparse (only STAR/SUPERSTAR/XFACTOR devTrait players have
  -- any), variably shaped, and only ever read wholesale for display - JSONB rather than
  -- forcing a fixed number of named columns or a child table.
  signature_abilities   JSONB,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, presentation_id, birth_year, birth_month, birth_day)
);
CREATE INDEX idx_players_team ON madden_players (league_id, team_id);
CREATE INDEX idx_players_position ON madden_players (league_id, position);
CREATE INDEX idx_players_roster_id ON madden_players (league_id, roster_id);
CREATE INDEX idx_players_rookie ON madden_players (league_id, years_pro) WHERE years_pro = 0;
CREATE INDEX idx_players_free_agent ON madden_players (league_id, is_free_agent) WHERE is_free_agent = true;

CREATE TABLE madden_players_history (LIKE madden_players INCLUDING DEFAULTS);
ALTER TABLE madden_players_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Every roster_id ever seen -> which stable player identity it belongs to.
-- Upserted on every MADDEN_PLAYER ingest. Lets stat rows (which only ever carry a
-- roster_id from EA) resolve to a player identity even after a title update has since
-- moved that roster_id's row on to a new value.
CREATE TABLE player_identity_map (
  league_id         TEXT NOT NULL,
  roster_id         INTEGER NOT NULL,
  presentation_id   INTEGER NOT NULL,
  birth_year        SMALLINT NOT NULL,
  birth_month       SMALLINT NOT NULL,
  birth_day         SMALLINT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, roster_id)
);

-- =====================================================================
-- Per-game stat tables (doc id = season${seasonIndex}-week${weekIndex}-${statId})
-- Only roster_id is stored (as EA sends it, unresolved). Identity is resolved at
-- READ time via a JOIN against player_identity_map (see idx_*_stats_roster below),
-- not denormalized here - keeps stat writes a plain bulk upsert with no join.
-- =====================================================================

CREATE TABLE madden_team_stats (
  league_id       TEXT NOT NULL,
  season_index    SMALLINT NOT NULL,
  week_index      SMALLINT NOT NULL,
  stat_id         INTEGER NOT NULL,
  platform        TEXT,
  team_id         INTEGER,
  schedule_id     INTEGER,
  stage_index     SMALLINT,
  seed            SMALLINT,
  total_wins      SMALLINT,
  total_losses    SMALLINT,
  total_ties      SMALLINT,
  to_diff         SMALLINT,
  to_takeaways    SMALLINT,
  to_giveaways    SMALLINT,
  penalties       SMALLINT,
  penalty_yds     INTEGER,
  off_pts_per_game      REAL,
  off_total_yds         INTEGER,
  off_total_yds_gained  INTEGER,
  off_pass_yds          INTEGER,
  off_rush_yds          INTEGER,
  off_rush_tds          SMALLINT,
  off_pass_tds          SMALLINT,
  off_sacks             SMALLINT,
  off_fum_lost           SMALLINT,
  off_ints_lost           SMALLINT,
  off_1st_downs           SMALLINT,
  off_3rd_down_att        SMALLINT,
  off_3rd_down_conv       SMALLINT,
  off_3rd_down_conv_pct   REAL,
  off_4th_down_att        SMALLINT,
  off_4th_down_conv       SMALLINT,
  off_4th_down_conv_pct   REAL,
  off_2pt_att             SMALLINT,
  off_2pt_conv            SMALLINT,
  off_2pt_conv_pct        REAL,
  off_red_zones            SMALLINT,
  off_red_zone_tds         SMALLINT,
  off_red_zone_fgs         SMALLINT,
  off_red_zone_pct         REAL,
  def_pts_per_game        REAL,
  def_total_yds            INTEGER,
  def_pass_yds             INTEGER,
  def_rush_yds             INTEGER,
  def_sacks                SMALLINT,
  def_forced_fum            SMALLINT,
  def_fum_rec               SMALLINT,
  def_ints_rec               SMALLINT,
  def_red_zones             SMALLINT,
  def_red_zone_tds          SMALLINT,
  def_red_zone_fgs          SMALLINT,
  def_red_zone_pct          REAL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, stat_id)
);
CREATE INDEX idx_team_stats_team ON madden_team_stats (league_id, team_id, season_index);

CREATE TABLE madden_team_stats_history (LIKE madden_team_stats INCLUDING DEFAULTS);
ALTER TABLE madden_team_stats_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();


CREATE TABLE madden_passing_stats (
  league_id           TEXT NOT NULL,
  season_index        SMALLINT NOT NULL,
  week_index          SMALLINT NOT NULL,
  stat_id             INTEGER NOT NULL,
  platform            TEXT,
  roster_id           INTEGER,
  team_id             INTEGER,
  schedule_id         INTEGER,
  stage_index         SMALLINT,
  full_name           TEXT,
  pass_att            SMALLINT,
  pass_comp           SMALLINT,
  pass_comp_pct       REAL,
  pass_yds            SMALLINT,
  pass_yds_per_att    REAL,
  pass_yds_per_game   REAL,
  pass_tds            SMALLINT,
  pass_ints           SMALLINT,
  pass_sacks          SMALLINT,
  pass_longest        SMALLINT,
  pass_pts            SMALLINT,
  passer_rating       REAL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, stat_id)
);
CREATE INDEX idx_passing_stats_roster ON madden_passing_stats (league_id, roster_id);

CREATE TABLE madden_passing_stats_history (LIKE madden_passing_stats INCLUDING DEFAULTS);
ALTER TABLE madden_passing_stats_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();


CREATE TABLE madden_rushing_stats (
  league_id             TEXT NOT NULL,
  season_index          SMALLINT NOT NULL,
  week_index            SMALLINT NOT NULL,
  stat_id               INTEGER NOT NULL,
  platform              TEXT,
  roster_id             INTEGER,
  team_id               INTEGER,
  schedule_id           INTEGER,
  stage_index           SMALLINT,
  full_name             TEXT,
  rush_att              SMALLINT,
  rush_yds              SMALLINT,
  rush_yds_per_att      REAL,
  rush_yds_per_game     REAL,
  rush_yds_after_contact SMALLINT,
  rush_tds              SMALLINT,
  rush_fum               SMALLINT,
  rush_broken_tackles    SMALLINT,
  rush_20_plus_yds       SMALLINT,
  rush_longest           SMALLINT,
  rush_to_pct            REAL,
  rush_pts               SMALLINT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, stat_id)
);
CREATE INDEX idx_rushing_stats_roster ON madden_rushing_stats (league_id, roster_id);

CREATE TABLE madden_rushing_stats_history (LIKE madden_rushing_stats INCLUDING DEFAULTS);
ALTER TABLE madden_rushing_stats_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();


CREATE TABLE madden_receiving_stats (
  league_id             TEXT NOT NULL,
  season_index          SMALLINT NOT NULL,
  week_index            SMALLINT NOT NULL,
  stat_id               INTEGER NOT NULL,
  platform              TEXT,
  roster_id             INTEGER,
  team_id               INTEGER,
  schedule_id           INTEGER,
  stage_index           SMALLINT,
  full_name             TEXT,
  rec_catches           SMALLINT,
  rec_catch_pct         REAL,
  rec_drops             SMALLINT,
  rec_yds               SMALLINT,
  rec_yds_per_catch     REAL,
  rec_yds_per_game      REAL,
  rec_yds_after_catch    SMALLINT,
  rec_yac_per_catch     REAL,
  rec_tds               SMALLINT,
  rec_longest            SMALLINT,
  rec_to_pct             REAL,
  rec_pts                SMALLINT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, stat_id)
);
CREATE INDEX idx_receiving_stats_roster ON madden_receiving_stats (league_id, roster_id);

CREATE TABLE madden_receiving_stats_history (LIKE madden_receiving_stats INCLUDING DEFAULTS);
ALTER TABLE madden_receiving_stats_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();


CREATE TABLE madden_defensive_stats (
  league_id           TEXT NOT NULL,
  season_index        SMALLINT NOT NULL,
  week_index          SMALLINT NOT NULL,
  stat_id             INTEGER NOT NULL,
  platform            TEXT,
  roster_id           INTEGER,
  team_id             INTEGER,
  schedule_id         INTEGER,
  stage_index         SMALLINT,
  full_name           TEXT,
  def_total_tackles   SMALLINT,
  def_sacks           REAL,   -- Madden reports partial (half) sacks
  def_ints            SMALLINT,
  def_int_return_yds  SMALLINT,
  def_deflections     SMALLINT,
  def_catch_allowed   SMALLINT,
  def_forced_fum      SMALLINT,
  def_fum_rec         SMALLINT,
  def_tds             SMALLINT,
  def_safeties        SMALLINT,
  def_pts             SMALLINT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, stat_id)
);
CREATE INDEX idx_defensive_stats_roster ON madden_defensive_stats (league_id, roster_id);

CREATE TABLE madden_defensive_stats_history (LIKE madden_defensive_stats INCLUDING DEFAULTS);
ALTER TABLE madden_defensive_stats_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();


CREATE TABLE madden_kicking_stats (
  league_id         TEXT NOT NULL,
  season_index      SMALLINT NOT NULL,
  week_index        SMALLINT NOT NULL,
  stat_id           INTEGER NOT NULL,
  platform          TEXT,
  roster_id         INTEGER,
  team_id           INTEGER,
  schedule_id       INTEGER,
  stage_index       SMALLINT,
  full_name         TEXT,
  fg_att            SMALLINT,
  fg_made           SMALLINT,
  fg_comp_pct       REAL,
  fg_longest        SMALLINT,
  fg_50_plus_att    SMALLINT,
  fg_50_plus_made   SMALLINT,
  xp_att            SMALLINT,
  xp_made           SMALLINT,
  xp_comp_pct       REAL,
  kickoff_att       SMALLINT,
  kickoff_tbs       SMALLINT,
  kick_pts          SMALLINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, stat_id)
);
CREATE INDEX idx_kicking_stats_roster ON madden_kicking_stats (league_id, roster_id);

CREATE TABLE madden_kicking_stats_history (LIKE madden_kicking_stats INCLUDING DEFAULTS);
ALTER TABLE madden_kicking_stats_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();


CREATE TABLE madden_punting_stats (
  league_id           TEXT NOT NULL,
  season_index        SMALLINT NOT NULL,
  week_index          SMALLINT NOT NULL,
  stat_id             INTEGER NOT NULL,
  platform            TEXT,
  roster_id           INTEGER,
  team_id             INTEGER,
  schedule_id         INTEGER,
  stage_index         SMALLINT,
  full_name           TEXT,
  punt_att            SMALLINT,
  punt_yds            SMALLINT,
  punt_yds_per_att    REAL,
  punt_net_yds        SMALLINT,
  punt_net_yds_per_att REAL,
  punt_longest        SMALLINT,
  punts_in_20         SMALLINT,
  punt_tbs            SMALLINT,
  punts_blocked       SMALLINT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season_index, week_index, stat_id)
);
CREATE INDEX idx_punting_stats_roster ON madden_punting_stats (league_id, roster_id);

CREATE TABLE madden_punting_stats_history (LIKE madden_punting_stats INCLUDING DEFAULTS);
ALTER TABLE madden_punting_stats_history
  ADD COLUMN history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT now();
