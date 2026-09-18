const xml2js = require('xml2js');

async function parseSoapResponse(xml) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false
  });

  return await parser.parseStringPromise(xml);
}

module.exports = {
  parseSoapResponse
};
