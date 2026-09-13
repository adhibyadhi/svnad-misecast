import { restaurant } from "../config/restaurant.js";
import { addBusinessDays, getBusinessDate } from "../utils/businessDate.js";
import { getSavedWeather } from "./weatherService.js";
import { getSavedHolidays } from "./holidayService.js";
import { getSavedEvents } from "./eventService.js";
import { getReservationContext } from "./reservationContextService.js";

function getSourceStatus(available, stale) {
  if (!available) {
    return "missing";
  }

  return stale ? "stale" : "fresh";
}

export async function getDailyContext() {
  const today = getBusinessDate(restaurant.timezone);

  const dates = Array.from({ length: 14 }, (_, index) =>
    addBusinessDays(today, index),
  );

  // A December forecast can require two years of holiday data.
  const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
  const [weather, events, holidayResults, reservations] = await Promise.all([
    getSavedWeather(),
    getSavedEvents(),
    Promise.all(
      years.map(async (year) => ({
        year,
        context: await getSavedHolidays(year),
      })),
    ),
    getReservationContext(today, dates[dates.length - 1], today),
  ]);

  const reservationsByDate = new Map(
    reservations.days.map((day) => [day.date, day.services]),
  );

  const holidaysByYear = new Map(
    holidayResults.map(({ year, context }) => [year, context]),
  );

  const weatherByDate = new Map(weather.rows.map((row) => [row.date, row]));

  const eventsByDate = new Map();

  for (const event of events.events) {
    const existing = eventsByDate.get(event.event_date) ?? [];
    existing.push(event);
    eventsByDate.set(event.event_date, existing);
  }

  const days = dates.map((date) => {
    const weatherRow = weatherByDate.get(date) ?? null;
    const weatherAvailable = weatherRow !== null;
    const weatherUsable = weatherAvailable && !weather.stale;

    const holidayContext = holidaysByYear.get(Number(date.slice(0, 4)));

    const holidayAvailable = Boolean(holidayContext?.available);
    const holidayUsable = holidayAvailable && !holidayContext.stale;

    const matchingHolidays =
      holidayContext?.holidays.filter((holiday) => holiday.date === date) ?? [];

    const eventDateCovered = Boolean(
      events.available &&
      events.dateStart &&
      events.dateEnd &&
      date >= events.dateStart &&
      date <= events.dateEnd,
    );

    const savedEvents = eventsByDate.get(date) ?? [];

    // A partial or filtered search cannot establish a complete count.
    const eventCountUsable =
      eventDateCovered &&
      !events.stale &&
      !events.truncated &&
      events.excludedCount === 0;

    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

    return {
      date,
      day_of_week: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][dayOfWeek],
      is_weekend: dayOfWeek === 0 || dayOfWeek === 6,
      reservations: {
        service_periods_known: reservations.service_periods_known,
        as_of_date: reservations.as_of_date,
        by_service: reservationsByDate.get(date) ?? [],
      },

      weather: {
        status: getSourceStatus(weatherAvailable, weather.stale),
        usable: weatherUsable,
        retrieved_at: weather.retrievedAt,
        data: weatherUsable ? weatherRow : null,
      },

      public_holiday: {
        status: getSourceStatus(
          holidayAvailable,
          holidayContext?.stale ?? true,
        ),
        usable: holidayUsable,
        retrieved_at: holidayContext?.retrievedAt ?? null,
        is_public_holiday: holidayUsable ? matchingHolidays.length > 0 : null,
        names: holidayUsable
          ? matchingHolidays.map((holiday) => holiday.name)
          : [],
      },

      local_events: {
        status: getSourceStatus(eventDateCovered, events.stale),
        retrieved_at: events.retrievedAt,
        date_covered: eventDateCovered,
        truncated: events.truncated,
        excluded_listing_count: events.excludedCount,

        // This is the count in the saved snapshot, even when stale.
        saved_listing_count: savedEvents.length,

        // This counts eligible provider listings, not all Melbourne events.
        provider_event_count: eventCountUsable ? savedEvents.length : null,
        count_usable: eventCountUsable,

        listings: savedEvents.map((event) => ({
          event_id: event.event_id,
          event_name: event.event_name,
          event_type: event.event_type,
          venue_name: event.venue_name,
          start_time: event.start_time,
          distance_from_restaurant_km: event.distance_from_restaurant_km,
        })),
      },
    };
  });

  return {
    restaurant_id: restaurant.restaurantId,
    timezone: restaurant.timezone,
    generated_at: new Date().toISOString(),
    date_start: dates[0],
    date_end: dates[dates.length - 1],
    days,
  };
}
