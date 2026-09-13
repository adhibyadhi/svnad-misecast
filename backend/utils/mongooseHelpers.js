export function handleMongooseError(res, error, defaultMessage) {
  console.error(defaultMessage, error);

  if (error.name === "ValidationError") {
    const messages = Object.values(error.errors).map((item) => item.message);

    return res.status(400).json({
      error: messages.join(" "),
    });
  }

  if (error.code === 11000) {
    return res.status(400).json({
      error: "A duplicate database record was found.",
    });
  }

  return res.status(500).json({
    error: defaultMessage,
  });
}
