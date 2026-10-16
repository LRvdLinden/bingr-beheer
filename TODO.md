# 🎬 BINGR — TODO

> **Openstaande taken** · Laatst bijgewerkt: 16 oktober 2026  
> Alleen nog niet-afgevinkte wensen en problemen. Eerder als afgerond gemarkeerde taken zijn weggelaten.

## 📊 Overzicht

| Prioriteit | Onderdeel | Open |
|:--|:--|--:|
| 🔴 P0 | IPTV en streams | 2 |
| 🟠 P1 | Statuspagina en buildverhuizing | 5 |
| 🟠 P1 | Echte pushnotificaties | 14 |
| 🟠 P1 | Beveiliging en SEO | 4 |
| 🟡 P2 | LG webOS | 3 |
| **Totaal** | | **28** |

**Prioriteiten:** 🔴 P0 = kritiek · 🟠 P1 = belangrijk · 🟡 P2 = ontwikkeling

---

## 🔴 P0 — IPTV en streams

- [ ] **IPTV-verbindingslimiet onderzoeken**  
  Provider meldt maximaal één verbinding; onderzoek relatie tot Bingr Gratis/Lifetime en toegestane oplossingen. Bingr kan providerlimieten niet zelfstandig opheffen.

- [ ] **Streams en sessies optimaliseren**  
  Bij zappen, stoppen, spelerwissel en afsluiten verbindingen correct vrijgeven; spooksessies voorkomen.

---

## 🟠 P1 — Statuspagina en buildverhuizing

- ✅ **Volledige statuspagina controleren**  
  Alle platformmonitors nalopen na de verhuizing van GitHub-builds naar beveiligde opslag op beheer.bingr.online.

- ✅ **Android latest.json HTTP 404 oplossen**  
  Android-versiecontrole moet weer geldige metadata ophalen in plaats van `versions/latest.json` 404.

- ✅ **Samsung TV latest.json HTTP 404 oplossen**  
  Tizen-versiecontrole moet weer geldige metadata ophalen in plaats van `versions/latest.json` 404.

- ✅ **Versiemetadata scheiden van privé-builds**  
  Platform, versie, build en publicatiestatus beschikbaar stellen zonder APK, WGT of Apple-pakketten openbaar aan te bieden.

- ✅ **Statuspagina en beheer synchroniseren**  
  Versie, build, laatste controle en storingsstatus consistent tonen; oude GitHub-404 is geen bewijs dat app offline is.

---

## 🟠 P1 — Echte pushnotificaties

- [ ] **Bestaande beheerschermmeldingen vervangen**  
  Bingr Beheer verstuurt echte systeem-pushmeldingen in plaats van eigen in-app pop-ups/banners.

- [ ] **OneSignal onderzoeken en integreren**  
  Centraal pushplatform met veilig server-side verzenden; gebruik zo nodig andere platformspecifieke diensten.

- [ ] **Platformondersteuning vaststellen**  
  iOS, iPadOS, macOS, Android, Google TV, Apple TV/tvOS, Samsung Tizen, LG webOS en web; systeem-push niet claimen waar niet ondersteund.

- [ ] **Automatische push bij elke nieuwe release**  
  Na succesvolle publicatie, ook bij uitsluitend een nieuw buildnummer binnen dezelfde versie.

- [ ] **Versie én buildnummer tonen**  
  Bijvoorbeeld `Bingr 1.0.1 (Build 105)` uit releasegegevens.

- [ ] **Platformgericht versturen**  
  Alleen naar gebruikers/apparaten voor het betreffende besturingssysteem.

- [ ] **Push in gebruikers eigen taal**  
  Vertalingen volgens ingestelde taal met fallback.

- [ ] **Juiste changelog-URL bij aantikken**  
  Exacte changelog van platform + versie + buildnummer openen.

- [ ] **Deeplink met browserfallback**  
  Changelog openen in de app waar mogelijk en anders via publieke URL.

- [ ] **Push verzenden vanuit beheer**  
  Eigen titel en bericht, gericht op alle gebruikers, specifieke accounts of platformen.

- [ ] **Pushrechten en apparaten registreren**  
  Toestemming, push-tokens, afmelden, uitloggen en apparaatverwijdering veilig verwerken.

- [ ] **Herinneringen als push versturen**  
  Bestaande programmaherinneringen per profiel naar de juiste apparaten afleveren.

- [ ] **Dubbele meldingen voorkomen**  
  Per gebruiker/apparaat en platformbuild dedupliceren.

- [ ] **Verzendgeschiedenis en afleverstatus**  
  In beheer inzicht geven in verzonden, mislukte en indien ondersteund afgeleverde pushberichten.

---

## 🟠 P1 — Beveiliging en SEO

- ✅ **Volledige securityaudit**  
  bingr.online, support.bingr.online en beheer.bingr.online controleren op secrets, autorisatieproblemen en kwetsbaarheden; Trail of Bits Skills toepassen.

- [ ] **Volledige SEO-audit via DataForSEO**  
  Publieke pagina's doorlichten op keywords, metadata, structured data, techniek en indexeerbaarheid.

- [ ] **SEO-teksten en interne links optimaliseren**  
  Relevante landingspagina's, zoekintentie, teksten en navigatie verbeteren.

- [ ] **Sitemap en zoekmachine-indexering**  
  `bingr.online/sitemap.xml` controleren of aanmaken; beheer niet indexeren en privépagina's daadwerkelijk afschermen.

---

## 🟡 P2 — LG webOS

- [ ] **LG webOS-app bouwen**  
  Op basis van Apple TV: profielen, koppelen, Live TV, films, series, zoeken, speler en instellingen.

- [ ] **LG webOS op website toevoegen**  
  Platform en werkelijke beschikbaarheidsstatus op de site en support verwerken.

- [ ] webOS ook koppelen aan OneSignal voor pushmeldingen

- [ ] **webOS-repository en builds koppelen**  
  `LRvdLinden/bingr-webOS` integreren met beveiligde buildworkflow via `BINGR_BEHEER_TOKEN` (alleen secret).

---

## 🔔 Voorbeeld: automatische releasemelding

> **Bingr 1.0.1 (Build 105) is beschikbaar! 🎉**  
> Er is een nieuwe versie voor Apple TV. Tik om de wijzigingen te bekijken.

**Acceptatiecriteria:** echte systeem-push waar ondersteund; juiste taal; juiste platform; versie + buildnummer; tik opent de **changelog van precies die build**; geen dubbele meldingen. Geen eigen in-app meldingsvensters als vervanging voor push.

## 🔐 Werkafspraken

- Geen wachtwoorden, tokens, IPTV-gegevens of privésleutels in dit bestand of GitHub-commits.
- Builddownloads blijven afgeschermd; openbare versiemetadata mag geen private downloadlinks blootgeven.
- Wijzigingen aan Bingr Beheer zelf worden niet in de openbare Bingr-changelog opgenomen.
- Een vinkje betekent **daadwerkelijk geïmplementeerd én getest**; deze lijst is een planning, geen verificatie van actuele implementaties.
