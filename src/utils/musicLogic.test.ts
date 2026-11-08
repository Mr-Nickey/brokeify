import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fisherYatesShuffle,
  lufsToLinearGain,
  computeTrackStabilizationGain,
  buildEmbyAuthHeader,
  buildJellyfinStreamUrl,
  buildSubsonicUrl,
  buildPlexStreamUrl,
  parseSpotifyExport,
  crossResolveTrack,
  EQ_PRESETS,
  ROTATING_SPITE_TAGLINES,
  buildJellyfinDisplayPrefsUrl,
  serializeCloudSettingsPayload,
  parseCloudSettingsResponse,
  mergeProvidersPreservingAuth,
  isLikelyJellyfinApiKey,
  matchJellyfinUserFromList,
  buildJellyfinInstantMixUrl,
  buildClientInstantMix,
  buildJellyfinPublicSystemInfoUrl,
  buildJellyfinQuickConnectInitiateUrl,
  buildJellyfinQuickConnectPollUrl,
  buildJellyfinQuickConnectAuthUrl,
  buildJellyfinAuthHeaders,
  buildJellyfinUsersMeUrl,
  buildJellyfinUserAudioItemsUrl,
  buildJellyfinUserPlaylistsUrl,
  buildJellyfinPlaylistItemsUrl,
  buildJellyfinGlobalAudioItemsUrl,
  buildJellyfinGlobalPlaylistsUrl,
  VISUAL_THEMES,
  isValidVisualTheme,
  computeBufferedAheadSeconds,
  getCanonicalSongSignature,
  areTracksSameSong,
  dedupeAndSpreadTracks,
  smartAntiRepeatShuffle,
  mergePlaylistsPreservingCustomNames,
} from './musicLogic';
import type {
  BrokeifyCloudSettings,
  Playlist,
  ProviderConfig,
  Track,
} from '../types/music';

test('Smart Anti-Repeat fingerprints duplicate downloader copies and never plays the same song back-to-back', () => {
  const dup1: Track = {
    id: 'jf-dup-1',
    title:
      '(When You Gonna) Give It Up To Me (Radio Version) - Sean Paul; Keyshia Cole',
    artist: 'a',
    album: 'Unknown',
    duration: 243,
    source: 'jellyfin',
    sourceName: 'Jellyfin',
    streamUrl: 'https://jellyfin.local/Audio/1/universal',
    artworkUrl: '',
    accentColor: '#10b981',
  };
  const dup2: Track = {
    ...dup1,
    id: 'jf-dup-2',
    streamUrl: 'https://jellyfin.local/Audio/2/universal',
  };
  const dup3: Track = {
    ...dup1,
    id: 'jf-dup-3',
    streamUrl: 'https://jellyfin.local/Audio/3/universal',
  };
  const cleanCopy: Track = {
    id: 'jf-dup-4',
    title:
      '(When You Gonna) Give It Up To Me (feat. Keyshia Cole) (Radio Version)',
    artist: 'Sean Paul',
    album: 'The Trinity',
    duration: 243,
    source: 'jellyfin',
    sourceName: 'Jellyfin',
    streamUrl: 'https://jellyfin.local/Audio/4/universal',
    artworkUrl: '',
    accentColor: '#10b981',
    format: 'FLAC',
    bitrateKbps: 980,
  };
  const otherSong: Track = {
    id: 'jf-other-1',
    title: 'Temperature',
    artist: 'Sean Paul',
    album: 'The Trinity',
    duration: 218,
    source: 'jellyfin',
    sourceName: 'Jellyfin',
    streamUrl: 'https://jellyfin.local/Audio/5/universal',
    artworkUrl: '',
    accentColor: '#10b981',
  };

  assert.equal(
    getCanonicalSongSignature(dup1),
    'when you gonna give it up to me'
  );
  assert.equal(
    getCanonicalSongSignature(cleanCopy),
    'when you gonna give it up to me'
  );
  assert.equal(areTracksSameSong(dup1, cleanCopy), true);
  assert.equal(areTracksSameSong(dup1, otherSong), false);

  // Deduplicating collapses the 4 copies into 1 (keeping the clean copy with artist "Sean Paul")
  const collapsed = dedupeAndSpreadTracks(
    [dup1, dup2, dup3, cleanCopy, otherSong],
    true
  );
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].id, 'jf-dup-4');
  assert.equal(collapsed[0].artist, 'Sean Paul');
  assert.equal(collapsed[1].id, 'jf-other-1');

  const shuffled = smartAntiRepeatShuffle(
    [dup1, dup2, dup3, cleanCopy, otherSong],
    true,
    () => 0.42
  );
  assert.equal(shuffled.length, 2);
});

test('mergePlaylistsPreservingCustomNames preserves custom playlist names while keeping the real server name in originalName', () => {
  const existing: Playlist[] = [
    {
      id: 'jellyfin-pl-101',
      name: 'Truck Driving Bangers',
      originalName: ' jellyfin_auto_import_2026 ',
      description: 'Synced playlist',
      source: 'jellyfin',
      trackIds: ['t1', 't2'],
      createdAt: '2026-11-01',
      coverAccent: '#10b981',
    },
  ];
  const incomingFromServer: Playlist[] = [
    {
      id: 'jellyfin-pl-101',
      name: 'jellyfin_auto_import_2026',
      description: 'Synced playlist updated',
      source: 'jellyfin',
      trackIds: ['t1', 't2', 't3'],
      createdAt: '2026-11-08',
      coverAccent: '#10b981',
    },
  ];

  const merged = mergePlaylistsPreservingCustomNames(
    existing,
    incomingFromServer,
    { 'jellyfin-pl-101': 'Truck Driving Bangers' }
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Truck Driving Bangers');
  assert.equal(merged[0].originalName, 'jellyfin_auto_import_2026');
  assert.deepEqual(merged[0].trackIds, ['t1', 't2', 't3']);
});

test('Proactive stream buffer defaults to 6s and computeBufferedAheadSeconds measures ahead cushion accurately', () => {
  const sampleSettings: BrokeifyCloudSettings = {
    version: 1,
    updatedAt: '2026-11-08T12:00:00.000Z',
    audioPrefs: {
      eqPreset: 'Car Stereo',
      eqGains: [4.5, 2.0, -1.5, 2.5, 4.0],
      carVolumeLeveler: true,
      lufsNormalizationEnabled: true,
      shuffleEnabled: false,
      repeatMode: 'all',
    },
    providers: [],
    playlists: [],
  };
  const parsed = parseCloudSettingsResponse(
    serializeCloudSettingsPayload(sampleSettings)
  );
  assert.equal(parsed?.audioPrefs.streamBufferSeconds, 6);

  assert.equal(computeBufferedAheadSeconds([], 10), 0);
  assert.equal(
    computeBufferedAheadSeconds([{ start: 0, end: 18.5 }], 12.0),
    6.5
  );
  assert.equal(
    computeBufferedAheadSeconds(
      [
        { start: 0, end: 5 },
        { start: 20, end: 32.4 },
      ],
      22.4
    ),
    10
  );
});

test('ROTATING_SPITE_TAGLINES includes all 3 required taglines', () => {
  assert.equal(ROTATING_SPITE_TAGLINES.length, 3);
  assert.ok(ROTATING_SPITE_TAGLINES[0].includes('Powered by spite and hard drives'));
  assert.ok(ROTATING_SPITE_TAGLINES[1].includes('Jellyfin + Navidrome + Emby + Plex'));
  assert.ok(ROTATING_SPITE_TAGLINES[2].includes('$11.99 a month is highway robbery'));
});

test('fisherYatesShuffle preserves all elements and does not mutate input', () => {
  const original = [1, 2, 3, 4, 5, 6];
  const copy = [...original];
  let seed = 0.15;
  const shuffled = fisherYatesShuffle(original, () => {
    seed = (seed + 0.37) % 1;
    return seed;
  });

  assert.deepEqual(original, copy);
  assert.equal(shuffled.length, original.length);
  assert.deepEqual([...shuffled].sort(), original);
});

test('lufsToLinearGain converts dB offsets accurately and clamps extremes', () => {
  assert.equal(lufsToLinearGain(0), 1);
  assert.equal(lufsToLinearGain(undefined), 1);
  // -6 dB is ~0.5012
  assert.equal(lufsToLinearGain(-6), 0.5012);
  // +6 dB is ~1.9953
  assert.equal(lufsToLinearGain(6), 1.9953);
  // Clamping below -12 dB
  assert.equal(lufsToLinearGain(-30), lufsToLinearGain(-12));
});

test('Jellyfin Quick Connect, Authenticated Headers, User-Scoped Endpoints, Subsonic, and Plex URL builders produce spec-compliant endpoints', () => {
  const header = buildEmbyAuthHeader('tok123');
  assert.ok(header.includes('Client="Brokeify"'));
  assert.ok(header.includes('Device="BrokeifyWeb"'));
  assert.ok(header.includes('DeviceId="brokeify-01"'));
  assert.ok(header.includes('Version="2.0.0"'));
  assert.ok(header.includes('Token="tok123"'));

  const authHeaders = buildJellyfinAuthHeaders('tok123');
  assert.equal(authHeaders['Accept'], 'application/json');
  assert.equal(authHeaders['X-Emby-Token'], 'tok123');
  assert.equal(
    authHeaders['Authorization'],
    'MediaBrowser Client="Brokeify", Device="BrokeifyWeb", DeviceId="brokeify-01", Version="2.0.0", Token="tok123"'
  );

  assert.equal(
    buildJellyfinPublicSystemInfoUrl('https://jellyfin.yourdomain.com/'),
    'https://jellyfin.yourdomain.com/System/Info/Public'
  );
  assert.equal(
    buildJellyfinQuickConnectInitiateUrl('https://jellyfin.yourdomain.com/'),
    'https://jellyfin.yourdomain.com/QuickConnect/Initiate'
  );
  assert.equal(
    buildJellyfinQuickConnectPollUrl('https://jellyfin.yourdomain.com/', 'sec-99'),
    'https://jellyfin.yourdomain.com/QuickConnect/Connect?Secret=sec-99'
  );
  assert.equal(
    buildJellyfinQuickConnectAuthUrl('https://jellyfin.yourdomain.com/'),
    'https://jellyfin.yourdomain.com/Users/AuthenticateWithQuickConnect'
  );
  assert.equal(
    buildJellyfinUsersMeUrl('https://jellyfin.yourdomain.com/', 'tok123'),
    'https://jellyfin.yourdomain.com/Users/Me?api_key=tok123'
  );
  assert.equal(
    buildJellyfinUserAudioItemsUrl('https://jellyfin.yourdomain.com/', 'uid-42', 'tok123'),
    'https://jellyfin.yourdomain.com/Users/uid-42/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources,NormalizationGain,Album,Artists&Limit=3000&api_key=tok123'
  );
  assert.equal(
    buildJellyfinUserPlaylistsUrl('https://jellyfin.yourdomain.com/', 'uid-42', 'tok123'),
    'https://jellyfin.yourdomain.com/Users/uid-42/Items?IncludeItemTypes=Playlist&Recursive=true&api_key=tok123'
  );
  assert.equal(
    buildJellyfinPlaylistItemsUrl('https://jellyfin.yourdomain.com/', 'pl-88', 'uid-42', 'tok123'),
    'https://jellyfin.yourdomain.com/Playlists/pl-88/Items?UserId=uid-42&Fields=MediaSources,NormalizationGain&api_key=tok123'
  );
  assert.equal(
    buildJellyfinGlobalAudioItemsUrl('https://jellyfin.yourdomain.com/', 'myKey32'),
    'https://jellyfin.yourdomain.com/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources,NormalizationGain,Album,Artists&Limit=3000&api_key=myKey32'
  );
  assert.equal(
    buildJellyfinGlobalPlaylistsUrl('https://jellyfin.yourdomain.com/', 'myKey32'),
    'https://jellyfin.yourdomain.com/Items?IncludeItemTypes=Playlist&Recursive=true&api_key=myKey32'
  );

  const jfUniversal = buildJellyfinStreamUrl('https://jellyfin.yourdomain.com/', 'item99', 'secretKey', 'user1', false);
  assert.equal(
    jfUniversal,
    'https://jellyfin.yourdomain.com/Audio/item99/universal?UserId=user1&DeviceId=brokeify-01&MaxStreamingBitrate=140000000&Container=mp3,flac,aac,m4a,ogg,wav,opus,webma,webm&TranscodingContainer=mp3&TranscodingProtocol=http&AudioCodec=mp3&api_key=secretKey'
  );

  const jfDirect = buildJellyfinStreamUrl('https://jellyfin.yourdomain.com/', 'item99', 'secretKey', 'user1', true);
  assert.equal(jfDirect, 'https://jellyfin.yourdomain.com/Audio/item99/stream?static=true&api_key=secretKey');

  const subsonic = buildSubsonicUrl(
    'https://navi.local',
    'stream',
    { username: 'admin', token: 'md5tok', salt: 'salty' },
    { id: 'tr-42', maxBitRate: 320 }
  );
  assert.ok(subsonic.startsWith('https://navi.local/rest/stream.view?'));
  assert.ok(subsonic.includes('v=1.16.1'));
  assert.ok(subsonic.includes('c=Brokeify'));
  assert.ok(subsonic.includes('maxBitRate=320'));

  const plex = buildPlexStreamUrl('http://192.168.1.50:32400/', '/library/parts/104/file.flac', 'plexTok');
  assert.equal(plex, 'http://192.168.1.50:32400/library/parts/104/file.flac?X-Plex-Token=plexTok');
});

test('isLikelyJellyfinApiKey and matchJellyfinUserFromList support Method A API Key authentication', () => {
  assert.equal(isLikelyJellyfinApiKey('a1b2c3d4e5f60718293a4b5c6d7e8f90'), true);
  assert.equal(isLikelyJellyfinApiKey('my-regular-password'), false);

  const sampleUsers = [
    { Id: 'u-guest', Name: 'Guest', Policy: { IsAdministrator: false } },
    { Id: 'u-admin', Name: 'AdminUser', Policy: { IsAdministrator: true } },
  ];
  assert.deepEqual(matchJellyfinUserFromList(sampleUsers, 'adminuser'), {
    id: 'u-admin',
    name: 'AdminUser',
  });
  assert.deepEqual(matchJellyfinUserFromList(sampleUsers, ''), {
    id: 'u-admin',
    name: 'AdminUser',
  });
});

test('parseSpotifyExport and crossResolveTrack resolve tracks against catalog', () => {
  const raw = `
    # Exported Spotify Playlist
    The Midnight - Sunset (Remastered)
    Kavinsky - Nightcall
  `;
  const parsed = parseSpotifyExport(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].artist, 'The Midnight');
  assert.equal(parsed[0].title, 'Sunset (Remastered)');

  const catalog: Track[] = [
    {
      id: 't1',
      title: 'Sunset',
      artist: 'The Midnight',
      album: 'Endless Summer',
      duration: 210,
      source: 'navidrome',
      sourceName: 'Home Navidrome',
      streamUrl: 'synth://sunset',
      artworkUrl: '',
      accentColor: '#10b981',
    },
  ];

  const resolved = crossResolveTrack(parsed[0], catalog);
  assert.equal(resolved.matchedTrack?.id, 't1');
  assert.equal(resolved.confidence, 100);
});

test('EQ_PRESETS has 5 bands for each required preset', () => {
  for (const preset of ['Car Stereo', 'Bass Boost', 'Rock', 'Vocal', 'Late Night'] as const) {
    assert.equal(EQ_PRESETS[preset].length, 5);
  }
});

test('Jellyfin DisplayPreferences Cloud Sync URL, serialization, and parsing round-trip cleanly', () => {
  const url = buildJellyfinDisplayPrefsUrl('https://jf.homelab.local/', 'user-42');
  assert.equal(
    url,
    'https://jf.homelab.local/DisplayPreferences/brokeify?userId=user-42&client=Brokeify'
  );

  const sampleSettings: BrokeifyCloudSettings = {
    version: 1,
    updatedAt: '2026-10-31T20:00:00.000Z',
    audioPrefs: {
      eqPreset: 'Bass Boost',
      eqGains: [6.5, 4.0, 0, 0.5, 1.5],
      carVolumeLeveler: true,
      lufsNormalizationEnabled: true,
      shuffleEnabled: true,
      repeatMode: 'all',
    },
    providers: [],
    playlists: [],
  };

  const payload = serializeCloudSettingsPayload(sampleSettings);
  assert.equal(payload.Id, 'brokeify');
  assert.equal(payload.Client, 'Brokeify');
  assert.ok(payload.CustomPrefs.brokeify_cloud_state);

  const restored = parseCloudSettingsResponse(payload);
  assert.ok(restored);
  assert.equal(restored.audioPrefs.eqPreset, 'Bass Boost');
  assert.deepEqual(restored.audioPrefs.eqGains, [6.5, 4.0, 0, 0.5, 1.5]);
  assert.equal(restored.audioPrefs.shuffleEnabled, true);
});

test('mergeProvidersPreservingAuth never clears saved auth tokens on offline or empty updates', () => {
  const existing: ProviderConfig[] = [
    {
      id: 'prov-jellyfin',
      type: 'jellyfin',
      name: 'Jellyfin Media Server',
      enabled: true,
      serverUrl: 'https://jf.myhome.net',
      username: 'musicfan',
      token: 'persisted-jf-token-999',
      userId: 'jf-uid-1',
      status: 'connected',
    },
  ];

  const incomingAfterTimeout: ProviderConfig[] = [
    {
      id: 'prov-jellyfin',
      type: 'jellyfin',
      name: 'Jellyfin Media Server',
      enabled: true,
      serverUrl: 'https://jf.myhome.net',
      username: 'musicfan',
      token: '', // Empty token from failed/partial response must NOT overwrite saved token
      userId: '',
      status: 'connected',
    },
  ];

  const merged = mergeProvidersPreservingAuth(existing, incomingAfterTimeout);
  assert.equal(merged[0].token, 'persisted-jf-token-999');
  assert.equal(merged[0].userId, 'jf-uid-1');
});

test('buildJellyfinInstantMixUrl and buildClientInstantMix generate smart radio mixes', () => {
  const mixUrl = buildJellyfinInstantMixUrl(
    'https://jellyfin.yourdomain.com/',
    'jellyfin-item42',
    'apiKey123',
    'user99',
    25
  );
  assert.ok(
    mixUrl.startsWith('https://jellyfin.yourdomain.com/Items/item42/InstantMix?')
  );
  assert.ok(mixUrl.includes('UserId=user99'));
  assert.ok(mixUrl.includes('Limit=25'));
  assert.ok(mixUrl.includes('api_key=apiKey123'));

  const seed: Track = {
    id: 's1',
    title: 'Midnight Synth',
    artist: 'Outrun Artist',
    album: 'Cyber',
    duration: 200,
    source: 'built-in',
    sourceName: 'Demo',
    streamUrl: 'synth://s1',
    artworkUrl: '',
    accentColor: '#10b981',
    genre: 'Synthwave',
    tags: ['outrun', 'night-drive'],
    bpm: 118,
  };
  const similar: Track = {
    id: 's2',
    title: 'Neon Highway',
    artist: 'Retro Wave',
    album: 'Cyber 2',
    duration: 195,
    source: 'built-in',
    sourceName: 'Demo',
    streamUrl: 'synth://s2',
    artworkUrl: '',
    accentColor: '#10b981',
    genre: 'Synthwave',
    tags: ['outrun', 'analog'],
    bpm: 120,
  };
  const different: Track = {
    id: 's3',
    title: 'Quiet Acoustic Ballad',
    artist: 'Folk Singer',
    album: 'Campfire',
    duration: 210,
    source: 'built-in',
    sourceName: 'Demo',
    streamUrl: 'synth://s3',
    artworkUrl: '',
    accentColor: '#f59e0b',
    genre: 'Acoustic',
    tags: ['ballad', 'chill'],
    bpm: 72,
  };

  const mix = buildClientInstantMix(seed, [seed, different, similar], 25, () => 0.5);
  assert.equal(mix.length, 3);
  assert.equal(mix[0].id, 's1');
  assert.equal(mix[1].id, 's2'); // High-affinity Synthwave track prioritized ahead of Acoustic track
  assert.equal(mix[2].id, 's3');
});

test('computeTrackStabilizationGain balances loud FLAC files and quiet 240kbps MP3 files in aggressive mode', () => {
  const flacTrack = {
    format: 'FLAC',
    bitrateKbps: 1411,
    normalizationGain: 0,
    streamUrl: 'https://jellyfin.local/Audio/1/stream.flac',
  };
  const mp3Track = {
    format: 'MP3',
    bitrateKbps: 240,
    normalizationGain: 0,
    streamUrl: 'https://jellyfin.local/Audio/2/stream.mp3',
  };

  const flacStab = computeTrackStabilizationGain(flacTrack, {
    carVolumeLeveler: true,
    lufsNormalizationEnabled: true,
    stabilizerStrength: 'aggressive',
  });
  const mp3Stab = computeTrackStabilizationGain(mp3Track, {
    carVolumeLeveler: true,
    lufsNormalizationEnabled: true,
    stabilizerStrength: 'aggressive',
  });

  // In aggressive mode, FLAC is attenuated (< 0.85 preamp, 0.58 stream ceiling) while 240kbps MP3 is boosted (> 2.0 preamp, 1.0 stream ceiling)
  assert.ok(flacStab.webAudioGain < 0.85);
  assert.equal(flacStab.htmlElementScale, 0.58);
  assert.ok(mp3Stab.webAudioGain > 2.0);
  assert.equal(mp3Stab.htmlElementScale, 1.0);
});

test('VISUAL_THEMES includes both dark and light skins with CSS filters and zero trademarked names', () => {
  const darkSkins = VISUAL_THEMES.filter((t) => t.mode === 'dark');
  const lightSkins = VISUAL_THEMES.filter((t) => t.mode === 'light');
  assert.ok(darkSkins.length >= 2);
  assert.ok(lightSkins.length >= 2);
  assert.ok(isValidVisualTheme('cyber-deck'));
  assert.ok(isValidVisualTheme('platinum-light'));
  assert.ok(!isValidVisualTheme('unknown-skin'));

  for (const theme of VISUAL_THEMES) {
    const combined = `${theme.name} ${theme.description} ${theme.badge}`.toLowerCase();
    assert.ok(!combined.includes('winamp'));
    assert.ok(!combined.includes('windows xp'));
    assert.ok(!combined.includes('milkdrop'));
  }
});



