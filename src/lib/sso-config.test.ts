import { describe, expect, it } from "vitest";
import {
  domainRecordName,
  domainRecordValue,
  domainsFromColumn,
  emailDomain,
  emailInDomains,
  instanceOidcFrom,
  MAX_SSO_DOMAINS,
  parseDomains,
  ssoEndpoints,
  ssoTrustedOriginsFrom,
  workspaceOfProvider,
  workspaceProviderId,
} from "./sso-config";

describe("instanceOidcFrom", () => {
  const base = { OIDC_ISSUER: "https://id.example.com/realms/acme/", OIDC_CLIENT_ID: "app", OIDC_CLIENT_SECRET: "s3cret" };

  it("is on only with an issuer URL, client id and secret", () => {
    expect(instanceOidcFrom({})).toBeNull();
    expect(instanceOidcFrom({ ...base, OIDC_CLIENT_SECRET: " " })).toBeNull();
    expect(instanceOidcFrom({ ...base, OIDC_ISSUER: "id.example.com" })).toBeNull();
    expect(instanceOidcFrom({ ...base, OIDC_ISSUER: "ftp://id.example.com" })).toBeNull();
  });

  it("keeps the issuer as given (ID tokens name it exactly), names the button and reads the domains", () => {
    expect(instanceOidcFrom({ ...base, OIDC_DOMAINS: "Example.com, @example.org" })).toEqual({
      issuer: "https://id.example.com/realms/acme/",
      clientId: "app",
      clientSecret: "s3cret",
      name: "SSO",
      domains: ["example.com", "example.org"],
    });
    expect(instanceOidcFrom({ ...base, OIDC_NAME: "Keycloak" })?.name).toBe("Keycloak");
  });

  it("ignores unusable domains instead of trusting them", () => {
    expect(instanceOidcFrom({ ...base, OIDC_DOMAINS: "gmail.com" })?.domains).toEqual([]);
  });
});

describe("ssoTrustedOriginsFrom", () => {
  it("trusts the instance issuer's origin and the listed ones", () => {
    expect(
      ssoTrustedOriginsFrom({
        OIDC_ISSUER: "http://keycloak:8080/realms/acme",
        OIDC_CLIENT_ID: "a",
        OIDC_CLIENT_SECRET: "b",
        SSO_TRUSTED_ORIGINS: "http://127.0.0.1:5199/path, not a url, javascript:alert(1), https://auth.internal",
      }),
    ).toEqual(["http://keycloak:8080", "http://127.0.0.1:5199", "https://auth.internal"]);
    expect(ssoTrustedOriginsFrom({})).toEqual([]);
  });
});

describe("provider ids", () => {
  it("map workspaces to providers and back", () => {
    expect(workspaceProviderId("abc")).toBe("ws-abc");
    expect(workspaceOfProvider("ws-abc")).toBe("abc");
    expect(workspaceOfProvider("oidc")).toBeNull();
    expect(workspaceOfProvider("ws-")).toBeNull();
    expect(workspaceOfProvider(null)).toBeNull();
  });
});

describe("parseDomains", () => {
  it("cleans up what owners type", () => {
    expect(parseDomains(" Example.com,@example.org; sub.example.com. example.com")).toEqual({
      ok: true,
      domains: ["example.com", "example.org", "sub.example.com"],
    });
    expect(parseDomains("")).toEqual({ ok: true, domains: [] });
  });

  it("refuses things that aren't domains", () => {
    expect(parseDomains("localhost")).toEqual({ ok: false, invalid: "localhost" });
    expect(parseDomains("exa mple.com")).toEqual({ ok: false, invalid: "exa" });
    expect(parseDomains("a@b.com")).toEqual({ ok: false, invalid: "a@b.com" });
    expect(parseDomains("10.0.0.1")).toEqual({ ok: false, invalid: "10.0.0.1" });
  });

  it("refuses public mail services, which no organization owns", () => {
    expect(parseDomains("example.com, Gmail.com")).toEqual({ ok: false, invalid: "gmail.com" });
    expect(parseDomains(["outlook.com"])).toEqual({ ok: false, invalid: "outlook.com" });
  });

  it("caps the number of domains", () => {
    const many = Array.from({ length: MAX_SSO_DOMAINS + 1 }, (_, i) => `d${i}.example.com`);
    expect(parseDomains(many).ok).toBe(false);
    expect(parseDomains(many.slice(0, MAX_SSO_DOMAINS)).ok).toBe(true);
  });
});

describe("email domains", () => {
  it("finds an address's domain", () => {
    expect(emailDomain("Ada@Example.COM ")).toBe("example.com");
    expect(emailDomain("@example.com")).toBeNull();
    expect(emailDomain("ada")).toBeNull();
  });

  it("matches subdomains but not look-alikes", () => {
    const domains = ["example.com"];
    expect(emailInDomains("ada@example.com", domains)).toBe(true);
    expect(emailInDomains("ada@eu.example.com", domains)).toBe(true);
    expect(emailInDomains("ada@badexample.com", domains)).toBe(false);
    expect(emailInDomains("ada@example.com.evil.io", domains)).toBe(false);
    expect(emailInDomains("ada@example.com", [])).toBe(false);
  });

  it("reads the plugin's comma-separated column", () => {
    expect(domainsFromColumn(" A.com,b.com ,,")).toEqual(["a.com", "b.com"]);
    expect(domainsFromColumn(null)).toEqual([]);
  });
});

describe("setup details", () => {
  it("names the DNS record that proves a domain", () => {
    expect(domainRecordName("example.com")).toBe("_esionage-sso.example.com");
    expect(domainRecordValue("tok")).toBe("esionage-sso=tok");
  });

  it("gives the identity provider the plugin's addresses", () => {
    expect(ssoEndpoints("https://notes.example.com/", "w1")).toEqual({
      providerId: "ws-w1",
      oidcRedirectUri: "https://notes.example.com/api/auth/sso/callback/ws-w1",
      samlAcsUrl: "https://notes.example.com/api/auth/sso/saml2/sp/acs/ws-w1",
      samlEntityId: "https://notes.example.com/api/auth/sso/saml2/sp/metadata?providerId=ws-w1",
      samlMetadataUrl: "https://notes.example.com/api/auth/sso/saml2/sp/metadata?providerId=ws-w1",
      scimBaseUrl: "https://notes.example.com/scim/v2",
    });
  });
});
