/**
 * ============================================================
 *  BACKFILL CONFIGURATION
 * ============================================================
 *  Set BACKFILL_MODE to true to re-run ingestion date-by-date
 *  from BACKFILL_START_DATE up to today.
 *
 *  Once all dates are processed, set BACKFILL_MODE back to false
 *  so the normal cron resumes.
 * ============================================================
 */

const BACKFILL_MODE = false; // 🔁 Toggle: true = backfill ON, false = normal cron

const BACKFILL_START_DATE = '2026-04-01'; // 📅 Start date (inclusive), format: YYYY-MM-DD

const BACKFILL_END_DATE = null; // 📅 End date (inclusive), null = today at runtime

module.exports = {
  BACKFILL_MODE,
  BACKFILL_START_DATE,
  BACKFILL_END_DATE,
};