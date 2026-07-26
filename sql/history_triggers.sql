-- History-capture triggers for madden_schema.sql's "latest state" tables.
--
-- Each trigger fires BEFORE UPDATE and, if any non-PK/non-updated_at column actually
-- changed, inserts the OLD row into the table's _history companion before the update
-- applies. updated_at is deliberately excluded from the comparison - it's bumped on
-- every write regardless of content, so including it would make every write look like
-- a change and produce a history row on every no-op re-export.
--
-- Mechanically generated (not hand-written - madden_players alone has ~140 columns) by
-- introspecting information_schema.columns/table_constraints against a freshly-migrated
-- database, then committed here as static SQL so the runtime trigger bodies never need
-- dynamic EXECUTE format(...) per row. Regenerate by re-running the equivalent
-- introspection query if madden_schema.sql's column set changes for any of these tables -
-- remember to re-apply by hand in that case, this file does not auto-update.

CREATE OR REPLACE FUNCTION madden_defensive_stats_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.def_total_tackles, OLD.def_sacks, OLD.def_ints, OLD.def_int_return_yds, OLD.def_deflections, OLD.def_catch_allowed, OLD.def_forced_fum, OLD.def_fum_rec, OLD.def_tds, OLD.def_safeties, OLD.def_pts) IS DISTINCT FROM (NEW.platform, NEW.roster_id, NEW.team_id, NEW.schedule_id, NEW.stage_index, NEW.full_name, NEW.def_total_tackles, NEW.def_sacks, NEW.def_ints, NEW.def_int_return_yds, NEW.def_deflections, NEW.def_catch_allowed, NEW.def_forced_fum, NEW.def_fum_rec, NEW.def_tds, NEW.def_safeties, NEW.def_pts) THEN
    INSERT INTO madden_defensive_stats_history (league_id, season_index, week_index, stat_id, platform, roster_id, team_id, schedule_id, stage_index, full_name, def_total_tackles, def_sacks, def_ints, def_int_return_yds, def_deflections, def_catch_allowed, def_forced_fum, def_fum_rec, def_tds, def_safeties, def_pts, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.stat_id, OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.def_total_tackles, OLD.def_sacks, OLD.def_ints, OLD.def_int_return_yds, OLD.def_deflections, OLD.def_catch_allowed, OLD.def_forced_fum, OLD.def_fum_rec, OLD.def_tds, OLD.def_safeties, OLD.def_pts, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_defensive_stats_history
  BEFORE UPDATE ON madden_defensive_stats
  FOR EACH ROW EXECUTE FUNCTION madden_defensive_stats_capture_history();

CREATE OR REPLACE FUNCTION madden_kicking_stats_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.fg_att, OLD.fg_made, OLD.fg_comp_pct, OLD.fg_longest, OLD.fg_50_plus_att, OLD.fg_50_plus_made, OLD.xp_att, OLD.xp_made, OLD.xp_comp_pct, OLD.kickoff_att, OLD.kickoff_tbs, OLD.kick_pts) IS DISTINCT FROM (NEW.platform, NEW.roster_id, NEW.team_id, NEW.schedule_id, NEW.stage_index, NEW.full_name, NEW.fg_att, NEW.fg_made, NEW.fg_comp_pct, NEW.fg_longest, NEW.fg_50_plus_att, NEW.fg_50_plus_made, NEW.xp_att, NEW.xp_made, NEW.xp_comp_pct, NEW.kickoff_att, NEW.kickoff_tbs, NEW.kick_pts) THEN
    INSERT INTO madden_kicking_stats_history (league_id, season_index, week_index, stat_id, platform, roster_id, team_id, schedule_id, stage_index, full_name, fg_att, fg_made, fg_comp_pct, fg_longest, fg_50_plus_att, fg_50_plus_made, xp_att, xp_made, xp_comp_pct, kickoff_att, kickoff_tbs, kick_pts, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.stat_id, OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.fg_att, OLD.fg_made, OLD.fg_comp_pct, OLD.fg_longest, OLD.fg_50_plus_att, OLD.fg_50_plus_made, OLD.xp_att, OLD.xp_made, OLD.xp_comp_pct, OLD.kickoff_att, OLD.kickoff_tbs, OLD.kick_pts, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_kicking_stats_history
  BEFORE UPDATE ON madden_kicking_stats
  FOR EACH ROW EXECUTE FUNCTION madden_kicking_stats_capture_history();

CREATE OR REPLACE FUNCTION madden_passing_stats_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.pass_att, OLD.pass_comp, OLD.pass_comp_pct, OLD.pass_yds, OLD.pass_yds_per_att, OLD.pass_yds_per_game, OLD.pass_tds, OLD.pass_ints, OLD.pass_sacks, OLD.pass_longest, OLD.pass_pts, OLD.passer_rating) IS DISTINCT FROM (NEW.platform, NEW.roster_id, NEW.team_id, NEW.schedule_id, NEW.stage_index, NEW.full_name, NEW.pass_att, NEW.pass_comp, NEW.pass_comp_pct, NEW.pass_yds, NEW.pass_yds_per_att, NEW.pass_yds_per_game, NEW.pass_tds, NEW.pass_ints, NEW.pass_sacks, NEW.pass_longest, NEW.pass_pts, NEW.passer_rating) THEN
    INSERT INTO madden_passing_stats_history (league_id, season_index, week_index, stat_id, platform, roster_id, team_id, schedule_id, stage_index, full_name, pass_att, pass_comp, pass_comp_pct, pass_yds, pass_yds_per_att, pass_yds_per_game, pass_tds, pass_ints, pass_sacks, pass_longest, pass_pts, passer_rating, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.stat_id, OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.pass_att, OLD.pass_comp, OLD.pass_comp_pct, OLD.pass_yds, OLD.pass_yds_per_att, OLD.pass_yds_per_game, OLD.pass_tds, OLD.pass_ints, OLD.pass_sacks, OLD.pass_longest, OLD.pass_pts, OLD.passer_rating, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_passing_stats_history
  BEFORE UPDATE ON madden_passing_stats
  FOR EACH ROW EXECUTE FUNCTION madden_passing_stats_capture_history();

CREATE OR REPLACE FUNCTION madden_players_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.roster_id, OLD.platform, OLD.team_id, OLD.first_name, OLD.last_name, OLD.position, OLD.jersey_num, OLD.age, OLD.height, OLD.weight, OLD.college, OLD.home_town, OLD.home_state, OLD.years_pro, OLD.rookie_year, OLD.draft_round, OLD.draft_pick, OLD.is_free_agent, OLD.is_active, OLD.is_on_practice_squad, OLD.is_on_ir, OLD.re_sign_status, OLD.dev_trait, OLD.scheme, OLD.team_scheme_ovr, OLD.player_scheme_ovr, OLD.player_best_ovr, OLD.legacy_score, OLD.experience_points, OLD.skill_points, OLD.production_grade, OLD.durability_grade, OLD.physical_grade, OLD.intangible_grade, OLD.size_grade, OLD.contract_salary, OLD.contract_bonus, OLD.contract_length, OLD.contract_years_left, OLD.cap_hit, OLD.cap_release_penalty, OLD.cap_release_net_savings, OLD.desired_salary, OLD.desired_bonus, OLD.desired_length, OLD.injury_type, OLD.injury_length, OLD.injury_rating, OLD.run_style, OLD.aware_rating, OLD.speed_rating, OLD.accel_rating, OLD.agility_rating, OLD.strength_rating, OLD.stamina_rating, OLD.tough_rating, OLD.jump_rating, OLD.cit_rating, OLD.throw_power_rating, OLD.throw_acc_rating, OLD.throw_acc_short_rating, OLD.throw_acc_mid_rating, OLD.throw_acc_deep_rating, OLD.throw_on_run_rating, OLD.throw_under_pressure_rating, OLD.play_action_rating, OLD.break_sack_rating, OLD.carry_rating, OLD.break_tackle_rating, OLD.truck_rating, OLD.stiff_arm_rating, OLD.spin_move_rating, OLD.juke_move_rating, OLD.bcv_rating, OLD.catch_rating, OLD.spec_catch_rating, OLD.route_run_short_rating, OLD.route_run_med_rating, OLD.route_run_deep_rating, OLD.release_rating, OLD.kick_power_rating, OLD.kick_acc_rating, OLD.kick_ret_rating, OLD.pass_block_rating, OLD.pass_block_power_rating, OLD.pass_block_finesse_rating, OLD.run_block_rating, OLD.run_block_power_rating, OLD.run_block_finesse_rating, OLD.lead_block_rating, OLD.impact_block_rating, OLD.tackle_rating, OLD.hit_power_rating, OLD.pursuit_rating, OLD.play_rec_rating, OLD.press_rating, OLD.man_cover_rating, OLD.zone_cover_rating, OLD.block_shed_rating, OLD.power_moves_rating, OLD.finesse_moves_rating, OLD.change_of_direction_rating, OLD.long_snap_rating, OLD.sense_pressure_trait, OLD.penalty_trait, OLD.play_ball_trait, OLD.cover_ball_trait, OLD.qb_style_trait, OLD.lb_style_trait, OLD.big_hit_trait, OLD.strip_ball_trait, OLD.high_motor_trait, OLD.clutch_trait, OLD.throw_away_trait, OLD.tight_spiral_trait, OLD.fight_for_yards_trait, OLD.predict_trait, OLD.dl_swim_trait, OLD.dl_spin_trait, OLD.dl_bull_rush_trait, OLD.feet_in_bounds_trait, OLD.pos_catch_trait, OLD.hp_catch_trait, OLD.drop_open_pass_trait, OLD.yac_catch_trait, OLD.signature_abilities) IS DISTINCT FROM (NEW.roster_id, NEW.platform, NEW.team_id, NEW.first_name, NEW.last_name, NEW.position, NEW.jersey_num, NEW.age, NEW.height, NEW.weight, NEW.college, NEW.home_town, NEW.home_state, NEW.years_pro, NEW.rookie_year, NEW.draft_round, NEW.draft_pick, NEW.is_free_agent, NEW.is_active, NEW.is_on_practice_squad, NEW.is_on_ir, NEW.re_sign_status, NEW.dev_trait, NEW.scheme, NEW.team_scheme_ovr, NEW.player_scheme_ovr, NEW.player_best_ovr, NEW.legacy_score, NEW.experience_points, NEW.skill_points, NEW.production_grade, NEW.durability_grade, NEW.physical_grade, NEW.intangible_grade, NEW.size_grade, NEW.contract_salary, NEW.contract_bonus, NEW.contract_length, NEW.contract_years_left, NEW.cap_hit, NEW.cap_release_penalty, NEW.cap_release_net_savings, NEW.desired_salary, NEW.desired_bonus, NEW.desired_length, NEW.injury_type, NEW.injury_length, NEW.injury_rating, NEW.run_style, NEW.aware_rating, NEW.speed_rating, NEW.accel_rating, NEW.agility_rating, NEW.strength_rating, NEW.stamina_rating, NEW.tough_rating, NEW.jump_rating, NEW.cit_rating, NEW.throw_power_rating, NEW.throw_acc_rating, NEW.throw_acc_short_rating, NEW.throw_acc_mid_rating, NEW.throw_acc_deep_rating, NEW.throw_on_run_rating, NEW.throw_under_pressure_rating, NEW.play_action_rating, NEW.break_sack_rating, NEW.carry_rating, NEW.break_tackle_rating, NEW.truck_rating, NEW.stiff_arm_rating, NEW.spin_move_rating, NEW.juke_move_rating, NEW.bcv_rating, NEW.catch_rating, NEW.spec_catch_rating, NEW.route_run_short_rating, NEW.route_run_med_rating, NEW.route_run_deep_rating, NEW.release_rating, NEW.kick_power_rating, NEW.kick_acc_rating, NEW.kick_ret_rating, NEW.pass_block_rating, NEW.pass_block_power_rating, NEW.pass_block_finesse_rating, NEW.run_block_rating, NEW.run_block_power_rating, NEW.run_block_finesse_rating, NEW.lead_block_rating, NEW.impact_block_rating, NEW.tackle_rating, NEW.hit_power_rating, NEW.pursuit_rating, NEW.play_rec_rating, NEW.press_rating, NEW.man_cover_rating, NEW.zone_cover_rating, NEW.block_shed_rating, NEW.power_moves_rating, NEW.finesse_moves_rating, NEW.change_of_direction_rating, NEW.long_snap_rating, NEW.sense_pressure_trait, NEW.penalty_trait, NEW.play_ball_trait, NEW.cover_ball_trait, NEW.qb_style_trait, NEW.lb_style_trait, NEW.big_hit_trait, NEW.strip_ball_trait, NEW.high_motor_trait, NEW.clutch_trait, NEW.throw_away_trait, NEW.tight_spiral_trait, NEW.fight_for_yards_trait, NEW.predict_trait, NEW.dl_swim_trait, NEW.dl_spin_trait, NEW.dl_bull_rush_trait, NEW.feet_in_bounds_trait, NEW.pos_catch_trait, NEW.hp_catch_trait, NEW.drop_open_pass_trait, NEW.yac_catch_trait, NEW.signature_abilities) THEN
    INSERT INTO madden_players_history (league_id, presentation_id, birth_year, birth_month, birth_day, roster_id, platform, team_id, first_name, last_name, position, jersey_num, age, height, weight, college, home_town, home_state, years_pro, rookie_year, draft_round, draft_pick, is_free_agent, is_active, is_on_practice_squad, is_on_ir, re_sign_status, dev_trait, scheme, team_scheme_ovr, player_scheme_ovr, player_best_ovr, legacy_score, experience_points, skill_points, production_grade, durability_grade, physical_grade, intangible_grade, size_grade, contract_salary, contract_bonus, contract_length, contract_years_left, cap_hit, cap_release_penalty, cap_release_net_savings, desired_salary, desired_bonus, desired_length, injury_type, injury_length, injury_rating, run_style, aware_rating, speed_rating, accel_rating, agility_rating, strength_rating, stamina_rating, tough_rating, jump_rating, cit_rating, throw_power_rating, throw_acc_rating, throw_acc_short_rating, throw_acc_mid_rating, throw_acc_deep_rating, throw_on_run_rating, throw_under_pressure_rating, play_action_rating, break_sack_rating, carry_rating, break_tackle_rating, truck_rating, stiff_arm_rating, spin_move_rating, juke_move_rating, bcv_rating, catch_rating, spec_catch_rating, route_run_short_rating, route_run_med_rating, route_run_deep_rating, release_rating, kick_power_rating, kick_acc_rating, kick_ret_rating, pass_block_rating, pass_block_power_rating, pass_block_finesse_rating, run_block_rating, run_block_power_rating, run_block_finesse_rating, lead_block_rating, impact_block_rating, tackle_rating, hit_power_rating, pursuit_rating, play_rec_rating, press_rating, man_cover_rating, zone_cover_rating, block_shed_rating, power_moves_rating, finesse_moves_rating, change_of_direction_rating, long_snap_rating, sense_pressure_trait, penalty_trait, play_ball_trait, cover_ball_trait, qb_style_trait, lb_style_trait, big_hit_trait, strip_ball_trait, high_motor_trait, clutch_trait, throw_away_trait, tight_spiral_trait, fight_for_yards_trait, predict_trait, dl_swim_trait, dl_spin_trait, dl_bull_rush_trait, feet_in_bounds_trait, pos_catch_trait, hp_catch_trait, drop_open_pass_trait, yac_catch_trait, signature_abilities, updated_at)
    VALUES (OLD.league_id, OLD.presentation_id, OLD.birth_year, OLD.birth_month, OLD.birth_day, OLD.roster_id, OLD.platform, OLD.team_id, OLD.first_name, OLD.last_name, OLD.position, OLD.jersey_num, OLD.age, OLD.height, OLD.weight, OLD.college, OLD.home_town, OLD.home_state, OLD.years_pro, OLD.rookie_year, OLD.draft_round, OLD.draft_pick, OLD.is_free_agent, OLD.is_active, OLD.is_on_practice_squad, OLD.is_on_ir, OLD.re_sign_status, OLD.dev_trait, OLD.scheme, OLD.team_scheme_ovr, OLD.player_scheme_ovr, OLD.player_best_ovr, OLD.legacy_score, OLD.experience_points, OLD.skill_points, OLD.production_grade, OLD.durability_grade, OLD.physical_grade, OLD.intangible_grade, OLD.size_grade, OLD.contract_salary, OLD.contract_bonus, OLD.contract_length, OLD.contract_years_left, OLD.cap_hit, OLD.cap_release_penalty, OLD.cap_release_net_savings, OLD.desired_salary, OLD.desired_bonus, OLD.desired_length, OLD.injury_type, OLD.injury_length, OLD.injury_rating, OLD.run_style, OLD.aware_rating, OLD.speed_rating, OLD.accel_rating, OLD.agility_rating, OLD.strength_rating, OLD.stamina_rating, OLD.tough_rating, OLD.jump_rating, OLD.cit_rating, OLD.throw_power_rating, OLD.throw_acc_rating, OLD.throw_acc_short_rating, OLD.throw_acc_mid_rating, OLD.throw_acc_deep_rating, OLD.throw_on_run_rating, OLD.throw_under_pressure_rating, OLD.play_action_rating, OLD.break_sack_rating, OLD.carry_rating, OLD.break_tackle_rating, OLD.truck_rating, OLD.stiff_arm_rating, OLD.spin_move_rating, OLD.juke_move_rating, OLD.bcv_rating, OLD.catch_rating, OLD.spec_catch_rating, OLD.route_run_short_rating, OLD.route_run_med_rating, OLD.route_run_deep_rating, OLD.release_rating, OLD.kick_power_rating, OLD.kick_acc_rating, OLD.kick_ret_rating, OLD.pass_block_rating, OLD.pass_block_power_rating, OLD.pass_block_finesse_rating, OLD.run_block_rating, OLD.run_block_power_rating, OLD.run_block_finesse_rating, OLD.lead_block_rating, OLD.impact_block_rating, OLD.tackle_rating, OLD.hit_power_rating, OLD.pursuit_rating, OLD.play_rec_rating, OLD.press_rating, OLD.man_cover_rating, OLD.zone_cover_rating, OLD.block_shed_rating, OLD.power_moves_rating, OLD.finesse_moves_rating, OLD.change_of_direction_rating, OLD.long_snap_rating, OLD.sense_pressure_trait, OLD.penalty_trait, OLD.play_ball_trait, OLD.cover_ball_trait, OLD.qb_style_trait, OLD.lb_style_trait, OLD.big_hit_trait, OLD.strip_ball_trait, OLD.high_motor_trait, OLD.clutch_trait, OLD.throw_away_trait, OLD.tight_spiral_trait, OLD.fight_for_yards_trait, OLD.predict_trait, OLD.dl_swim_trait, OLD.dl_spin_trait, OLD.dl_bull_rush_trait, OLD.feet_in_bounds_trait, OLD.pos_catch_trait, OLD.hp_catch_trait, OLD.drop_open_pass_trait, OLD.yac_catch_trait, OLD.signature_abilities, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_players_history
  BEFORE UPDATE ON madden_players
  FOR EACH ROW EXECUTE FUNCTION madden_players_capture_history();

CREATE OR REPLACE FUNCTION madden_punting_stats_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.punt_att, OLD.punt_yds, OLD.punt_yds_per_att, OLD.punt_net_yds, OLD.punt_net_yds_per_att, OLD.punt_longest, OLD.punts_in_20, OLD.punt_tbs, OLD.punts_blocked) IS DISTINCT FROM (NEW.platform, NEW.roster_id, NEW.team_id, NEW.schedule_id, NEW.stage_index, NEW.full_name, NEW.punt_att, NEW.punt_yds, NEW.punt_yds_per_att, NEW.punt_net_yds, NEW.punt_net_yds_per_att, NEW.punt_longest, NEW.punts_in_20, NEW.punt_tbs, NEW.punts_blocked) THEN
    INSERT INTO madden_punting_stats_history (league_id, season_index, week_index, stat_id, platform, roster_id, team_id, schedule_id, stage_index, full_name, punt_att, punt_yds, punt_yds_per_att, punt_net_yds, punt_net_yds_per_att, punt_longest, punts_in_20, punt_tbs, punts_blocked, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.stat_id, OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.punt_att, OLD.punt_yds, OLD.punt_yds_per_att, OLD.punt_net_yds, OLD.punt_net_yds_per_att, OLD.punt_longest, OLD.punts_in_20, OLD.punt_tbs, OLD.punts_blocked, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_punting_stats_history
  BEFORE UPDATE ON madden_punting_stats
  FOR EACH ROW EXECUTE FUNCTION madden_punting_stats_capture_history();

CREATE OR REPLACE FUNCTION madden_receiving_stats_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.rec_catches, OLD.rec_catch_pct, OLD.rec_drops, OLD.rec_yds, OLD.rec_yds_per_catch, OLD.rec_yds_per_game, OLD.rec_yds_after_catch, OLD.rec_yac_per_catch, OLD.rec_tds, OLD.rec_longest, OLD.rec_to_pct, OLD.rec_pts) IS DISTINCT FROM (NEW.platform, NEW.roster_id, NEW.team_id, NEW.schedule_id, NEW.stage_index, NEW.full_name, NEW.rec_catches, NEW.rec_catch_pct, NEW.rec_drops, NEW.rec_yds, NEW.rec_yds_per_catch, NEW.rec_yds_per_game, NEW.rec_yds_after_catch, NEW.rec_yac_per_catch, NEW.rec_tds, NEW.rec_longest, NEW.rec_to_pct, NEW.rec_pts) THEN
    INSERT INTO madden_receiving_stats_history (league_id, season_index, week_index, stat_id, platform, roster_id, team_id, schedule_id, stage_index, full_name, rec_catches, rec_catch_pct, rec_drops, rec_yds, rec_yds_per_catch, rec_yds_per_game, rec_yds_after_catch, rec_yac_per_catch, rec_tds, rec_longest, rec_to_pct, rec_pts, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.stat_id, OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.rec_catches, OLD.rec_catch_pct, OLD.rec_drops, OLD.rec_yds, OLD.rec_yds_per_catch, OLD.rec_yds_per_game, OLD.rec_yds_after_catch, OLD.rec_yac_per_catch, OLD.rec_tds, OLD.rec_longest, OLD.rec_to_pct, OLD.rec_pts, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_receiving_stats_history
  BEFORE UPDATE ON madden_receiving_stats
  FOR EACH ROW EXECUTE FUNCTION madden_receiving_stats_capture_history();

CREATE OR REPLACE FUNCTION madden_rushing_stats_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.rush_att, OLD.rush_yds, OLD.rush_yds_per_att, OLD.rush_yds_per_game, OLD.rush_yds_after_contact, OLD.rush_tds, OLD.rush_fum, OLD.rush_broken_tackles, OLD.rush_20_plus_yds, OLD.rush_longest, OLD.rush_to_pct, OLD.rush_pts) IS DISTINCT FROM (NEW.platform, NEW.roster_id, NEW.team_id, NEW.schedule_id, NEW.stage_index, NEW.full_name, NEW.rush_att, NEW.rush_yds, NEW.rush_yds_per_att, NEW.rush_yds_per_game, NEW.rush_yds_after_contact, NEW.rush_tds, NEW.rush_fum, NEW.rush_broken_tackles, NEW.rush_20_plus_yds, NEW.rush_longest, NEW.rush_to_pct, NEW.rush_pts) THEN
    INSERT INTO madden_rushing_stats_history (league_id, season_index, week_index, stat_id, platform, roster_id, team_id, schedule_id, stage_index, full_name, rush_att, rush_yds, rush_yds_per_att, rush_yds_per_game, rush_yds_after_contact, rush_tds, rush_fum, rush_broken_tackles, rush_20_plus_yds, rush_longest, rush_to_pct, rush_pts, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.stat_id, OLD.platform, OLD.roster_id, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.full_name, OLD.rush_att, OLD.rush_yds, OLD.rush_yds_per_att, OLD.rush_yds_per_game, OLD.rush_yds_after_contact, OLD.rush_tds, OLD.rush_fum, OLD.rush_broken_tackles, OLD.rush_20_plus_yds, OLD.rush_longest, OLD.rush_to_pct, OLD.rush_pts, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_rushing_stats_history
  BEFORE UPDATE ON madden_rushing_stats
  FOR EACH ROW EXECUTE FUNCTION madden_rushing_stats_capture_history();

CREATE OR REPLACE FUNCTION madden_schedules_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.stage_index, OLD.status, OLD.home_team_id, OLD.away_team_id, OLD.home_score, OLD.away_score, OLD.is_game_of_the_week) IS DISTINCT FROM (NEW.platform, NEW.stage_index, NEW.status, NEW.home_team_id, NEW.away_team_id, NEW.home_score, NEW.away_score, NEW.is_game_of_the_week) THEN
    INSERT INTO madden_schedules_history (league_id, season_index, week_index, schedule_id, platform, stage_index, status, home_team_id, away_team_id, home_score, away_score, is_game_of_the_week, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.schedule_id, OLD.platform, OLD.stage_index, OLD.status, OLD.home_team_id, OLD.away_team_id, OLD.home_score, OLD.away_score, OLD.is_game_of_the_week, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_schedules_history
  BEFORE UPDATE ON madden_schedules
  FOR EACH ROW EXECUTE FUNCTION madden_schedules_capture_history();

CREATE OR REPLACE FUNCTION madden_standings_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.season_index, OLD.week_index, OLD.stage_index, OLD.calendar_year, OLD.rank, OLD.prev_rank, OLD.seed, OLD.division_id, OLD.division_name, OLD.conference_id, OLD.conference_name, OLD.playoff_status, OLD.team_name, OLD.team_ovr, OLD.total_wins, OLD.total_losses, OLD.total_ties, OLD.home_wins, OLD.home_losses, OLD.home_ties, OLD.away_wins, OLD.away_losses, OLD.away_ties, OLD.div_wins, OLD.div_losses, OLD.div_ties, OLD.conf_wins, OLD.conf_losses, OLD.conf_ties, OLD.win_pct, OLD.win_loss_streak, OLD.pts_for, OLD.pts_for_rank, OLD.pts_against, OLD.pts_against_rank, OLD.net_pts, OLD.off_total_yds, OLD.off_total_yds_rank, OLD.off_pass_yds, OLD.off_pass_yds_rank, OLD.off_rush_yds, OLD.off_rush_yds_rank, OLD.def_total_yds, OLD.def_total_yds_rank, OLD.def_pass_yds, OLD.def_pass_yds_rank, OLD.def_rush_yds, OLD.def_rush_yds_rank, OLD.to_diff, OLD.cap_available, OLD.cap_room, OLD.cap_spent) IS DISTINCT FROM (NEW.platform, NEW.season_index, NEW.week_index, NEW.stage_index, NEW.calendar_year, NEW.rank, NEW.prev_rank, NEW.seed, NEW.division_id, NEW.division_name, NEW.conference_id, NEW.conference_name, NEW.playoff_status, NEW.team_name, NEW.team_ovr, NEW.total_wins, NEW.total_losses, NEW.total_ties, NEW.home_wins, NEW.home_losses, NEW.home_ties, NEW.away_wins, NEW.away_losses, NEW.away_ties, NEW.div_wins, NEW.div_losses, NEW.div_ties, NEW.conf_wins, NEW.conf_losses, NEW.conf_ties, NEW.win_pct, NEW.win_loss_streak, NEW.pts_for, NEW.pts_for_rank, NEW.pts_against, NEW.pts_against_rank, NEW.net_pts, NEW.off_total_yds, NEW.off_total_yds_rank, NEW.off_pass_yds, NEW.off_pass_yds_rank, NEW.off_rush_yds, NEW.off_rush_yds_rank, NEW.def_total_yds, NEW.def_total_yds_rank, NEW.def_pass_yds, NEW.def_pass_yds_rank, NEW.def_rush_yds, NEW.def_rush_yds_rank, NEW.to_diff, NEW.cap_available, NEW.cap_room, NEW.cap_spent) THEN
    INSERT INTO madden_standings_history (league_id, team_id, platform, season_index, week_index, stage_index, calendar_year, rank, prev_rank, seed, division_id, division_name, conference_id, conference_name, playoff_status, team_name, team_ovr, total_wins, total_losses, total_ties, home_wins, home_losses, home_ties, away_wins, away_losses, away_ties, div_wins, div_losses, div_ties, conf_wins, conf_losses, conf_ties, win_pct, win_loss_streak, pts_for, pts_for_rank, pts_against, pts_against_rank, net_pts, off_total_yds, off_total_yds_rank, off_pass_yds, off_pass_yds_rank, off_rush_yds, off_rush_yds_rank, def_total_yds, def_total_yds_rank, def_pass_yds, def_pass_yds_rank, def_rush_yds, def_rush_yds_rank, to_diff, cap_available, cap_room, cap_spent, updated_at)
    VALUES (OLD.league_id, OLD.team_id, OLD.platform, OLD.season_index, OLD.week_index, OLD.stage_index, OLD.calendar_year, OLD.rank, OLD.prev_rank, OLD.seed, OLD.division_id, OLD.division_name, OLD.conference_id, OLD.conference_name, OLD.playoff_status, OLD.team_name, OLD.team_ovr, OLD.total_wins, OLD.total_losses, OLD.total_ties, OLD.home_wins, OLD.home_losses, OLD.home_ties, OLD.away_wins, OLD.away_losses, OLD.away_ties, OLD.div_wins, OLD.div_losses, OLD.div_ties, OLD.conf_wins, OLD.conf_losses, OLD.conf_ties, OLD.win_pct, OLD.win_loss_streak, OLD.pts_for, OLD.pts_for_rank, OLD.pts_against, OLD.pts_against_rank, OLD.net_pts, OLD.off_total_yds, OLD.off_total_yds_rank, OLD.off_pass_yds, OLD.off_pass_yds_rank, OLD.off_rush_yds, OLD.off_rush_yds_rank, OLD.def_total_yds, OLD.def_total_yds_rank, OLD.def_pass_yds, OLD.def_pass_yds_rank, OLD.def_rush_yds, OLD.def_rush_yds_rank, OLD.to_diff, OLD.cap_available, OLD.cap_room, OLD.cap_spent, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_standings_history
  BEFORE UPDATE ON madden_standings
  FOR EACH ROW EXECUTE FUNCTION madden_standings_capture_history();

CREATE OR REPLACE FUNCTION madden_team_stats_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.seed, OLD.total_wins, OLD.total_losses, OLD.total_ties, OLD.to_diff, OLD.to_takeaways, OLD.to_giveaways, OLD.penalties, OLD.penalty_yds, OLD.off_pts_per_game, OLD.off_total_yds, OLD.off_total_yds_gained, OLD.off_pass_yds, OLD.off_rush_yds, OLD.off_rush_tds, OLD.off_pass_tds, OLD.off_sacks, OLD.off_fum_lost, OLD.off_ints_lost, OLD.off_1st_downs, OLD.off_3rd_down_att, OLD.off_3rd_down_conv, OLD.off_3rd_down_conv_pct, OLD.off_4th_down_att, OLD.off_4th_down_conv, OLD.off_4th_down_conv_pct, OLD.off_2pt_att, OLD.off_2pt_conv, OLD.off_2pt_conv_pct, OLD.off_red_zones, OLD.off_red_zone_tds, OLD.off_red_zone_fgs, OLD.off_red_zone_pct, OLD.def_pts_per_game, OLD.def_total_yds, OLD.def_pass_yds, OLD.def_rush_yds, OLD.def_sacks, OLD.def_forced_fum, OLD.def_fum_rec, OLD.def_ints_rec, OLD.def_red_zones, OLD.def_red_zone_tds, OLD.def_red_zone_fgs, OLD.def_red_zone_pct) IS DISTINCT FROM (NEW.platform, NEW.team_id, NEW.schedule_id, NEW.stage_index, NEW.seed, NEW.total_wins, NEW.total_losses, NEW.total_ties, NEW.to_diff, NEW.to_takeaways, NEW.to_giveaways, NEW.penalties, NEW.penalty_yds, NEW.off_pts_per_game, NEW.off_total_yds, NEW.off_total_yds_gained, NEW.off_pass_yds, NEW.off_rush_yds, NEW.off_rush_tds, NEW.off_pass_tds, NEW.off_sacks, NEW.off_fum_lost, NEW.off_ints_lost, NEW.off_1st_downs, NEW.off_3rd_down_att, NEW.off_3rd_down_conv, NEW.off_3rd_down_conv_pct, NEW.off_4th_down_att, NEW.off_4th_down_conv, NEW.off_4th_down_conv_pct, NEW.off_2pt_att, NEW.off_2pt_conv, NEW.off_2pt_conv_pct, NEW.off_red_zones, NEW.off_red_zone_tds, NEW.off_red_zone_fgs, NEW.off_red_zone_pct, NEW.def_pts_per_game, NEW.def_total_yds, NEW.def_pass_yds, NEW.def_rush_yds, NEW.def_sacks, NEW.def_forced_fum, NEW.def_fum_rec, NEW.def_ints_rec, NEW.def_red_zones, NEW.def_red_zone_tds, NEW.def_red_zone_fgs, NEW.def_red_zone_pct) THEN
    INSERT INTO madden_team_stats_history (league_id, season_index, week_index, stat_id, platform, team_id, schedule_id, stage_index, seed, total_wins, total_losses, total_ties, to_diff, to_takeaways, to_giveaways, penalties, penalty_yds, off_pts_per_game, off_total_yds, off_total_yds_gained, off_pass_yds, off_rush_yds, off_rush_tds, off_pass_tds, off_sacks, off_fum_lost, off_ints_lost, off_1st_downs, off_3rd_down_att, off_3rd_down_conv, off_3rd_down_conv_pct, off_4th_down_att, off_4th_down_conv, off_4th_down_conv_pct, off_2pt_att, off_2pt_conv, off_2pt_conv_pct, off_red_zones, off_red_zone_tds, off_red_zone_fgs, off_red_zone_pct, def_pts_per_game, def_total_yds, def_pass_yds, def_rush_yds, def_sacks, def_forced_fum, def_fum_rec, def_ints_rec, def_red_zones, def_red_zone_tds, def_red_zone_fgs, def_red_zone_pct, updated_at)
    VALUES (OLD.league_id, OLD.season_index, OLD.week_index, OLD.stat_id, OLD.platform, OLD.team_id, OLD.schedule_id, OLD.stage_index, OLD.seed, OLD.total_wins, OLD.total_losses, OLD.total_ties, OLD.to_diff, OLD.to_takeaways, OLD.to_giveaways, OLD.penalties, OLD.penalty_yds, OLD.off_pts_per_game, OLD.off_total_yds, OLD.off_total_yds_gained, OLD.off_pass_yds, OLD.off_rush_yds, OLD.off_rush_tds, OLD.off_pass_tds, OLD.off_sacks, OLD.off_fum_lost, OLD.off_ints_lost, OLD.off_1st_downs, OLD.off_3rd_down_att, OLD.off_3rd_down_conv, OLD.off_3rd_down_conv_pct, OLD.off_4th_down_att, OLD.off_4th_down_conv, OLD.off_4th_down_conv_pct, OLD.off_2pt_att, OLD.off_2pt_conv, OLD.off_2pt_conv_pct, OLD.off_red_zones, OLD.off_red_zone_tds, OLD.off_red_zone_fgs, OLD.off_red_zone_pct, OLD.def_pts_per_game, OLD.def_total_yds, OLD.def_pass_yds, OLD.def_rush_yds, OLD.def_sacks, OLD.def_forced_fum, OLD.def_fum_rec, OLD.def_ints_rec, OLD.def_red_zones, OLD.def_red_zone_tds, OLD.def_red_zone_fgs, OLD.def_red_zone_pct, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_team_stats_history
  BEFORE UPDATE ON madden_team_stats
  FOR EACH ROW EXECUTE FUNCTION madden_team_stats_capture_history();

CREATE OR REPLACE FUNCTION madden_teams_capture_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.platform, OLD.ovr_rating, OLD.injury_count, OLD.div_name, OLD.city_name, OLD.logo_id, OLD.abbr_name, OLD.user_name, OLD.nick_name, OLD.off_scheme, OLD.secondary_color, OLD.primary_color, OLD.def_scheme, OLD.display_name) IS DISTINCT FROM (NEW.platform, NEW.ovr_rating, NEW.injury_count, NEW.div_name, NEW.city_name, NEW.logo_id, NEW.abbr_name, NEW.user_name, NEW.nick_name, NEW.off_scheme, NEW.secondary_color, NEW.primary_color, NEW.def_scheme, NEW.display_name) THEN
    INSERT INTO madden_teams_history (league_id, team_id, platform, ovr_rating, injury_count, div_name, city_name, logo_id, abbr_name, user_name, nick_name, off_scheme, secondary_color, primary_color, def_scheme, display_name, updated_at)
    VALUES (OLD.league_id, OLD.team_id, OLD.platform, OLD.ovr_rating, OLD.injury_count, OLD.div_name, OLD.city_name, OLD.logo_id, OLD.abbr_name, OLD.user_name, OLD.nick_name, OLD.off_scheme, OLD.secondary_color, OLD.primary_color, OLD.def_scheme, OLD.display_name, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_madden_teams_history
  BEFORE UPDATE ON madden_teams
  FOR EACH ROW EXECUTE FUNCTION madden_teams_capture_history();

