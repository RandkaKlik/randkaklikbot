const locales = {
  pl: require("../locales/pl.json"),
  ru: require("../locales/ru.json"),
  ua: require("../locales/ua.json"),
  en: require("../locales/en.json"),
};

function localize(language, key) {
  return locales[language][key] || locales["pl"][key] || key;
}

module.exports = { localize };
