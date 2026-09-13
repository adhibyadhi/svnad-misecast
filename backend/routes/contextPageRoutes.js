import { Router } from "express";
import { restaurant } from "../config/restaurant.js";
import { addBusinessDays, getBusinessDate } from "../utils/businessDate.js";
import { getDailyContext } from "../services/dailyContextService.js";
import {
  refreshWeather,
  WeatherRefreshError,
} from "../services/weatherService.js";
import {
  refreshHolidays,
  HolidayRefreshError,
} from "../services/holidayService.js";
import { refreshEvents, EventRefreshError } from "../services/eventService.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", async (req, res) => {
  res.render("context/index", {
    pageTitle: "Daily context",
    context: await getDailyContext(),
    refreshResults: [],
  });
});

router.post("/refresh", async (req, res) => {
  const today = getBusinessDate(restaurant.timezone);
  const lastDate = addBusinessDays(today, 13);

  const years = [
    ...new Set([Number(today.slice(0, 4)), Number(lastDate.slice(0, 4))]),
  ];

  const tasks = [
    {
      label: "Weather",
      run: () => refreshWeather(),
    },
    ...years.map((year) => ({
      label: `Victorian public holidays (${year})`,
      run: () => refreshHolidays(year),
    })),
    {
      label: "Nearby events",
      run: () => refreshEvents(),
    },
  ];

  const refreshResults = [];

  for (const task of tasks) {
    try {
      await task.run();

      refreshResults.push({
        label: task.label,
        success: true,
        message: "Ready. Fresh saved data may have been reused.",
      });
    } catch (error) {
      const knownError =
        error instanceof WeatherRefreshError ||
        error instanceof HolidayRefreshError ||
        error instanceof EventRefreshError;

      refreshResults.push({
        label: task.label,
        success: false,
        message: knownError
          ? error.message
          : "Refresh failed. Check the provider configuration and database connection.",
      });
    }
  }

  // The page reports each source's outcome separately.
  res.render("context/index", {
    pageTitle: "Daily context",
    context: await getDailyContext(),
    refreshResults,
  });
});

export default router;
