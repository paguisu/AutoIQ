const {
  buildGetTokenEnvelope,
  parseGetTokenResponse,
} = require('../services/sancor/auth');

describe('Sancor auth', () => {
  test('arma el envelope de GetToken con el contrato correcto', () => {
    const xml = buildGetTokenEnvelope({
      user: 'pasesores911ws',
      password: 'Psiivr223vce',
      system: 'PolicyIssuance',
      connection: 'Ceibo',
    });

    expect(xml).toContain('<req:getToken>');
    expect(xml).toContain('<Credentials>');
    expect(xml).toContain('<User>pasesores911ws</User>');
    expect(xml).toContain('<Password>Psiivr223vce</Password>');
    expect(xml).toContain('<System>PolicyIssuance</System>');
    expect(xml).toContain('<Connection>Ceibo</Connection>');
  });

  test('parsea una respuesta exitosa de GetToken', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NS1:Envelope xmlns:NS1="http://schemas.xmlsoap.org/soap/envelope/">
  <NS1:Header>
    <NS2:responseHeader xmlns:NS2="http://gruposancorseguros.com/ents/SOI/Commons/v1.0">
      <responseStatus><statusCode>Success</statusCode></responseStatus>
    </NS2:responseHeader>
  </NS1:Header>
  <NS1:Body>
    <NS3:getTokenResponse xmlns:NS3="http://gruposancorseguros.com/ents/SOI/SecuritySvc/GetToken/response">
      <Token>
        <AccessToken>access-123</AccessToken>
        <IdToken>header.payload.sig</IdToken>
        <TokenType>Bearer</TokenType>
      </Token>
      <Result>
        <ErrorCode>SOA-GSS-0000</ErrorCode>
        <ErrorMsg>Success</ErrorMsg>
      </Result>
    </NS3:getTokenResponse>
  </NS1:Body>
</NS1:Envelope>`;

    expect(parseGetTokenResponse(xml)).toMatchObject({
      ok: true,
      accessToken: 'access-123',
      idToken: 'header.payload.sig',
      tokenType: 'Bearer',
      errorCode: 'SOA-GSS-0000',
      errorMsg: 'Success',
      responseStatus: 'Success',
    });
  });
});
