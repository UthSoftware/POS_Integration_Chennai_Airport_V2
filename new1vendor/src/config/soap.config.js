module.exports = {
  SOAP_URL: process.env.SOAP_URL || 'http://10.40.71.32:8080/eShopaidServices.asmx',
  SOAP_ACTION: process.env.SOAP_ACTION || 'http://eshopaid.in/GetResponseAsDataSet',

  AUTH: {
    USERNAME: process.env.SOAP_USERNAME || 'admin',
    PASSWORD: process.env.SOAP_PASSWORD || 'pass',
    GROUP_CODE: process.env.SOAP_GROUP_CODE || '',
    STORE_CODE: process.env.SOAP_STORE_CODE || ''
  },

  TIMEOUT: parseInt(process.env.SOAP_TIMEOUT) || 60000
};
