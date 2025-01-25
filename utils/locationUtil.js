const axios = require("axios");

async function reverseGeocode(latitude, longitude) {
  try {
    const response = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: {
          lat: latitude,
          lon: longitude,
          format: "json",
        },
      }
    );

    if (response.data && response.data.address) {
      return (
        response.data.address.city ||
        response.data.address.town ||
        "Unknown City"
      );
    }
    return "Unknown City";
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    return "Unknown City";
  }
}

module.exports = { reverseGeocode };
