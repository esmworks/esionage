import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The database isn't touched by the functions tested here.
vi.mock("@/db", () => ({ db: {} }));

const { discoverOidc, keepSamlInput, normalizeCertificate, samlConfigFor, SsoError } = await import("./sso");

const ISSUER = "https://id.example.com/realms/acme";
const discovery = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/certs`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    ...overrides,
  });
const CERT_BODY = "MII" + "A".repeat(180);

const saved = { ...process.env };
beforeEach(() => {
  process.env.APP_URL = "https://notes.example.com";
  delete process.env.SSO_TRUSTED_ORIGINS;
  delete process.env.OIDC_ISSUER;
});
afterEach(() => {
  process.env = { ...saved };
});

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SsoError);
  return (error as InstanceType<typeof SsoError>).code;
};

describe("discoverOidc", () => {
  it("reads the endpoints from the issuer's discovery document", async () => {
    const urls: string[] = [];
    const result = await discoverOidc(ISSUER, async (url) => {
      urls.push(url);
      return discovery({ token_endpoint_auth_methods_supported: ["client_secret_post"] });
    });
    expect(urls).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
    expect(result).toEqual({
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksEndpoint: `${ISSUER}/certs`,
      userInfoEndpoint: `${ISSUER}/userinfo`,
      tokenEndpointAuthentication: "client_secret_post",
    });
    expect((await discoverOidc(ISSUER, async () => discovery())).tokenEndpointAuthentication).toBe("client_secret_basic");
  });

  it("refuses a document for another issuer, or one it can't read", async () => {
    expect(await codeOf(discoverOidc(ISSUER, async () => discovery({ issuer: "https://evil.example.com" })))).toBe("discoveryFailed");
    expect(await codeOf(discoverOidc(ISSUER, async () => "<html>"))).toBe("discoveryFailed");
    expect(
      await codeOf(
        discoverOidc(ISSUER, async () => {
          throw new Error("timeout");
        }),
      ),
    ).toBe("discoveryFailed");
  });

  it("wants https endpoints, except on trusted origins", async () => {
    const plain = discovery({ token_endpoint: "http://10.0.0.5/token" });
    expect(await codeOf(discoverOidc(ISSUER, async () => plain))).toBe("discoveryFailed");
    process.env.SSO_TRUSTED_ORIGINS = "http://10.0.0.5";
    expect((await discoverOidc(ISSUER, async () => plain)).tokenEndpoint).toBe("http://10.0.0.5/token");
  });

  it("needs the required endpoints", async () => {
    expect(await codeOf(discoverOidc(ISSUER, async () => discovery({ jwks_uri: undefined })))).toBe("discoveryFailed");
    expect((await discoverOidc(ISSUER, async () => discovery({ userinfo_endpoint: undefined }))).userInfoEndpoint).toBeUndefined();
  });
});

describe("SAML settings", () => {
  it("normalizes pasted certificates to PEM", () => {
    const pem = normalizeCertificate(`-----BEGIN CERTIFICATE-----\n${CERT_BODY}\n-----END CERTIFICATE-----`);
    expect(pem).toMatch(/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=]{64}\n/);
    expect(normalizeCertificate(CERT_BODY)).toBe(pem);
    expect(normalizeCertificate("not a certificate")).toBeNull();
    expect(normalizeCertificate("")).toBeNull();
  });

  it("makes this app the service provider and requires signed assertions", () => {
    const config = samlConfigFor("w1", {
      protocol: "saml",
      entryPoint: "https://idp.example.com/sso",
      idpEntityId: "https://idp.example.com",
      certificate: CERT_BODY,
      domains: "example.com",
    });
    const entityId = "https://notes.example.com/api/auth/sso/saml2/sp/metadata?providerId=ws-w1";
    expect(config).toMatchObject({
      issuer: entityId,
      audience: entityId,
      wantAssertionsSigned: true,
      entryPoint: "https://idp.example.com/sso",
      idpMetadata: { entityID: "https://idp.example.com" },
    });
  });

  it("takes the identity provider's metadata XML instead", () => {
    const xml = `<md:EntityDescriptor entityID="https://idp.example.com"><md:IDPSSODescriptor><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/></md:IDPSSODescriptor></md:EntityDescriptor>`;
    const config = samlConfigFor("w1", { protocol: "saml", metadataXml: xml, domains: "example.com" });
    expect(config.entryPoint).toBe("https://idp.example.com/sso");
    expect(config.idpMetadata).toEqual({ metadata: xml });
  });

  it("refuses incomplete details", () => {
    expect(() => samlConfigFor("w1", { protocol: "saml", metadataXml: "<html/>", domains: "" })).toThrow(SsoError);
    expect(() =>
      samlConfigFor("w1", { protocol: "saml", entryPoint: "https://idp.example.com/sso", idpEntityId: "x", certificate: "", domains: "" }),
    ).toThrow(SsoError);
    expect(() =>
      samlConfigFor("w1", { protocol: "saml", entryPoint: "javascript:alert(1)", idpEntityId: "x", certificate: CERT_BODY, domains: "" }),
    ).toThrow(SsoError);
  });

  it("keeps the stored metadata or certificate when an edit leaves them empty", () => {
    const stored = { entryPoint: "https://idp.example.com/sso", cert: "PEM", idpMetadata: { metadata: "<xml/>" } };
    expect(keepSamlInput({ protocol: "saml", domains: "a.com" }, stored).metadataXml).toBe("<xml/>");
    expect(keepSamlInput({ protocol: "saml", entryPoint: "https://x/sso", idpEntityId: "x", domains: "a.com" }, stored).certificate).toBe(
      "PEM",
    );
    expect(keepSamlInput({ protocol: "saml", metadataXml: "<new/>", domains: "a.com" }, stored).metadataXml).toBe("<new/>");
    expect(keepSamlInput({ protocol: "saml", domains: "a.com" }, null).metadataXml).toBeUndefined();
  });
});
