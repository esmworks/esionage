# esionage — v1 görev listesi

**Bitti tanımı:** `docker compose up` ile ayağa kalkan; e-posta/şifre ile kayıt/giriş, workspace, iç içe sayfalar,
BlockNote editör (Yjs ile canlı ortak düzenleme), tablo + board görünümlü veritabanları, arama, sayfa geçmişi
(snapshot + geri yükleme); Claude gibi istemcilerin OAuth 2.1 (CIMD/DCR + PKCE + consent) ile bağlanıp
okuyup yazabildiği `/mcp` endpoint'i. Build geçiyor, akışlar tarayıcıda ve bir MCP istemcisiyle uçtan uca doğrulanmış.

## Altyapı
- [x] Sürüm doğrulaması (Node 24 LTS, Postgres 18, TS 6 — Next 16.3 TS API'si ^6 istiyor)
- [x] tsconfig, next.config, Tailwind, ESLint'siz minimal kurulum
- [x] Drizzle şeması: auth tabloları, workspace, member, page, database property/view, page_snapshot
- [x] Migration üretimi + migrate script
- [x] Custom server: Next + Hocuspocus aynı process, `/collab` websocket upgrade
- [x] docker-compose (postgres:18-alpine + app node:24), Dockerfile, .env.example, README

## Auth
- [x] Better Auth: e-posta/şifre, Drizzle adapter
- [x] Kayıt / giriş sayfaları, ilk girişte kişisel workspace
- [x] Workspace üyeleri (e-posta ile ekleme, rol: owner/member) + yeni workspace

## Sayfalar ve editör
- [x] Workspace ana sayfası (son düzenlenenler, hızlı oluşturma)
- [x] Sidebar sayfa ağacı (iç içe, oluştur, yeniden adlandır, çöpe at/geri al)
- [x] BlockNote editör + Hocuspocus provider (canlı düzenleme, imleçler)
- [x] Hocuspocus kalıcılık: Yjs state → DB, düz metin + markdown türevi (arama/MCP için)
- [x] Sayfa başlığı/ikon düzenleme
- [x] Arama (başlık + içerik)

## Veritabanları  _(alt ajan: database-ui)_
- [x] Veritabanı sayfası: property tipleri (text, number, select, multi_select, date, checkbox, url)
- [x] Tablo görünümü: satır ekle, hücre düzenle, property ekle/sil/yeniden adlandır
- [x] Board görünümü: select property'e göre grupla, sürükle-bırak
- [x] Sıralama + basit filtre
- [x] Satırı sayfa olarak aç (property başlığı + editör)

## Geçmiş
- [x] page_snapshot: store sırasında seyreltilmiş snapshot + her MCP yazmasından önce zorunlu snapshot
- [x] Geçmiş paneli: liste, önizleme, geri yükleme

## MCP + OAuth  _(alt ajan: mcp)_
- [x] Better Auth `mcp()` + `jwt()` + `cimd()`, DCR açık (eski istemciler için)
- [x] Kök /.well-known keşif adresleri (AS, OIDC, PRM) + eski istemciler için alias
- [x] Consent sayfası (imza doğrulama, sade dilde scope'lar, salt-okunur seçeneği)
- [x] `/mcp` route: requireMcpAuth + createMcpHandler (2025 + 2026-07-28 protokolleri)
- [x] Araçlar: list_workspaces, search, get_page, list_pages, create_page, update_page, archive_page,
      get_database, query_database, create_database_row, update_database_row (+ create_database, add_database_property)
- [x] Yazmalar Hocuspocus direct connection üzerinden (açık editörlere anlık yansır — tarayıcıda doğrulandı)
- [x] Ayarlar: bağlı OAuth istemcileri listesi + erişimi kaldırma
- [x] DCR: `application_type` göndermeyen loopback-redirect'li eski istemciler → before-hook ile "native"
- [ ] Gerçek bir istemciyle (Claude / Claude Code) bağlantı denemesi — kullanıcıda (repo dışı yapılandırma)

## Doğrulama
- [x] typecheck + build (build Docker imajı içinde)
- [x] Birim testleri (markdown↔blok dönüşümü, yetki kontrolleri, property doğrulama)
- [x] Tarayıcıda uçtan uca: kayıt, sayfa, iki sekmede canlı düzenleme, veritabanı, geçmiş, arama, çöp, ikon, ayarlar
- [x] MCP uçtan uca: OAuth akışı + araç çağrıları (`pnpm tsx scripts/mcp-e2e.ts`, 114 kontrol)
- [x] Docker compose ile temiz kurulum (ayrı proje, 114/114 MCP e2e + /collab senkronu)

## Sonraki aşama (v1 dışı)
- Yorumlar, diff'li geçmiş, offline-first, gelişmiş presence, sosyal giriş, public paylaşım linkleri
