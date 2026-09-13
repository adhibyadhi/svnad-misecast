/**
 * External API helper functions.
 *
 * This file currently handles:
 *
 * 1. Weather - Open-Meteo
 * 2. Public holidays - Nager.Date
 *
 * Ticketmaster will be added later.
 */

/**
 * WEATHER API
 *
 * Get weather for every requested prediction date.
 *
 * Returns:
 *
 * [
 *   {
 *     date: "2026-09-20",
 *     avg_temp: 18.4,
 *     rain: false
 *   }
 * ]
 */
export async function getWeatherData(requestedDates) {
  const latitude = process.env.RESTAURANT_LATITUDE;

  const longitude = process.env.RESTAURANT_LONGITUDE;

  /*
   * Make sure the restaurant location
   * has been configured.
   */
  if (!latitude || !longitude) {
    throw new Error("Restaurant latitude and longitude are missing from .env.");
  }

  /*
   * Open-Meteo can provide up to
   * 16 forecast days.
   *
   * We request:
   *
   * temperature_2m_mean
   * = average temperature for the day
   *
   * rain_sum
   * = total rain for the day
   */
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude}` +
    `&longitude=${longitude}` +
    "&daily=temperature_2m_mean,rain_sum" +
    "&timezone=auto" +
    "&forecast_days=16";

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Weather API request failed with status ${response.status}. ${body}`.trim());
  }

  const data = await response.json();

  /*
   * Check that daily weather was returned.
   */
  if (!data.daily || !Array.isArray(data.daily.time)) {
    throw new Error("Weather API returned invalid data.");
  }

  const weatherData = [];

  /*
   * Find weather for each date requested
   * by the user.
   */
  for (const requestedDate of requestedDates) {
    const index = data.daily.time.indexOf(requestedDate);

    /*
     * If the date isn't in the response,
     * it is probably outside the weather
     * forecast range.
     */
    if (index === -1) {
      throw new Error(
        `Weather forecast is not available for ${requestedDate}.`,
      );
    }

    const averageTemperature = data.daily.temperature_2m_mean[index];

    const rainAmount = data.daily.rain_sum[index];

    weatherData.push({
      date: requestedDate,

      avg_temp: Number(averageTemperature),

      /*
       * ML only needs true / false.
       *
       * Any rain amount above 0
       * counts as rain.
       */
      rain: Number(rainAmount) > 0,
    });
  }

  return weatherData;
}

/**
 * PUBLIC HOLIDAY API
 *
 * Get public holiday information for
 * every requested date.
 *
 * Returns:
 *
 * [
 *   {
 *     date: "2026-12-25",
 *     public_holiday: true,
 *     name: "Christmas Day"
 *   }
 * ]
 */
export async function getHolidayData(requestedDates) {
  const countryCode = process.env.HOLIDAY_COUNTRY_CODE;

  const subdivision = process.env.HOLIDAY_SUBDIVISION;

  if (!countryCode) {
    throw new Error("HOLIDAY_COUNTRY_CODE is missing from .env.");
  }

  /*
   * Prediction can cross New Year.
   *
   * Example:
   *
   * 2026-12-29
   * ...
   * 2027-01-04
   *
   * Therefore find every unique year.
   */
  const years = [...new Set(requestedDates.map((date) => date.slice(0, 4)))];

  let allHolidays = [];

  /*
   * Fetch holiday data once
   * for each required year.
   */
  for (const year of years) {
    const url =
      "https://date.nager.at/api/v3/PublicHolidays/" + `${year}/${countryCode}`;

    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Public holiday API request failed for ${year} with status ${response.status}. ${body}`.trim());
    }

    const holidays = await response.json();

    allHolidays = allHolidays.concat(holidays);
  }

  const holidayData = [];

  /*
   * Check every requested date.
   */
  for (const requestedDate of requestedDates) {
    const holiday = allHolidays.find((item) => {
      /*
       * First check the date.
       */
      if (item.date !== requestedDate) {
        return false;
      }

      /*
       * National holiday.
       */
      if (item.global === true) {
        return true;
      }

      /*
       * Some holidays are limited
       * to specific states/regions.
       *
       * Example:
       * AU-VIC = Victoria.
       */
      if (
        subdivision &&
        Array.isArray(item.counties) &&
        item.counties.includes(subdivision)
      ) {
        return true;
      }

      return false;
    });

    holidayData.push({
      date: requestedDate,

      public_holiday: Boolean(holiday),

      /*
       * The ML model does not need
       * the holiday name.
       *
       * We keep it temporarily because
       * it may be useful for debugging
       * or display.
       */
      name: holiday ? holiday.localName || holiday.name : null,
    });
  }

  return holidayData;
}

/**
 * TICKETMASTER API
 *
 * Gets the number of Ticketmaster events
 * for every requested prediction date.
 *
 * Returns:
 *
 * [
 *   {
 *     date: "2026-09-20",
 *     num_of_event: 12
 *   },
 *   {
 *     date: "2026-09-21",
 *     num_of_event: 8
 *   }
 * ]
 */
export async function getEventData(requestedDates) {
  const apiKey = process.env.TICKETMASTER_API_KEY;

  const city = process.env.TICKETMASTER_CITY;

  const countryCode = process.env.TICKETMASTER_COUNTRY_CODE;

  /*
   * Check configuration.
   */
  if (!apiKey) {
    throw new Error("TICKETMASTER_API_KEY is missing from .env.");
  }

  if (!city) {
    throw new Error("TICKETMASTER_CITY is missing from .env.");
  }

  if (!countryCode) {
    throw new Error("TICKETMASTER_COUNTRY_CODE is missing from .env.");
  }

  if (!Array.isArray(requestedDates) || requestedDates.length === 0) {
    return [];
  }

  /*
   * Ticketmaster returns event date/time data.
   *
   * We make the API search slightly wider
   * than our requested range.
   *
   * We then use each event's localDate
   * to count it against the correct day.
   *
   * This avoids timezone problems.
   */

  const firstDate = new Date(`${requestedDates[0]}T00:00:00.000Z`);

  firstDate.setUTCDate(firstDate.getUTCDate() - 1);

  const lastDate = new Date(
    `${requestedDates[requestedDates.length - 1]}T23:59:59.999Z`,
  );

  lastDate.setUTCDate(lastDate.getUTCDate() + 1);

  /*
   * Ticketmaster may return multiple pages.
   *
   * We collect the events from every page
   * that we need.
   */
  const allEvents = [];

  let pageNumber = 0;

  const pageSize = 200;

  while (true) {
    /*
     * URLSearchParams safely creates:
     *
     * ?apikey=...
     * &city=Melbourne
     * &countryCode=AU
     * etc.
     */
    const formatTicketmasterDate = (date) => {
      return date.toISOString().replace(/\.\d{3}Z$/, "Z");
    };

    const params = new URLSearchParams({
      apikey: apiKey,

      city: city,

      countryCode: countryCode,
      startDateTime: formatTicketmasterDate(firstDate),
      endDateTime: formatTicketmasterDate(lastDate),

      size: String(pageSize),

      page: String(pageNumber),

      sort: "date,asc",

      includeTBA: "no",

      includeTBD: "no",
    });

    const url =
      "https://app.ticketmaster.com/discovery/v2/events.json" +
      `?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.text();

      console.error("Ticketmaster status:", response.status);
      console.error("Ticketmaster response:", errorBody);

      if (response.status === 401) {
        throw new Error("Ticketmaster API key is invalid.");
      }

      throw new Error(
        `Ticketmaster API request failed with status ${response.status}.`,
      );
    }

    const data = await response.json();

    /*
     * If there are no events,
     * _embedded may not exist.
     */
    const events = data._embedded?.events ?? [];

    allEvents.push(...events);

    /*
     * Ticketmaster includes paging information
     * in the response.
     */
    const totalPages = data.page?.totalPages ?? 0;

    /*
     * No more pages.
     */
    if (pageNumber + 1 >= totalPages) {
      break;
    }

    pageNumber++;

    /*
     * Ticketmaster restricts deep paging.
     *
     * 5 pages x 200 = 1000 events.
     */
    if (pageNumber >= 5) {
      throw new Error(
        "Too many Ticketmaster events were returned for this prediction period.",
      );
    }
  }

  /*
   * --------------------------------------------------
   * COUNT EVENTS FOR EACH DATE
   * --------------------------------------------------
   *
   * Ticketmaster event objects contain:
   *
   * event.dates.start.localDate
   *
   * Example:
   *
   * "2026-09-20"
   */

  const eventData = requestedDates.map((requestedDate) => {
    const numberOfEvents = allEvents.filter(
      (event) => event.dates?.start?.localDate === requestedDate,
    ).length;

    return {
      date: requestedDate,

      num_of_event: numberOfEvents,
    };
  });

  return eventData;
}
