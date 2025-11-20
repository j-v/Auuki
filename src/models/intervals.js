import { xf, once, print, exists, } from '../functions.js';
import { isoDate, } from '../utils.js';
import { OAuthService, DialogMsg, stateParam, } from './enums.js';
import config from './config.js';
import { LocalStorageItem } from '../storage/local-storage.js';

const intervals_base_uri = 'https://intervals.icu/api/v1';

function Intervals(args = {}) {
    const serviceName = OAuthService.intervals;
    const api_uri = config.get().API_URI;
    const pwa_uri = config.get().PWA_URI;
    let intervals_client_id = config.get().INTERVALS_CLIENT_ID;

    const update = function() {
        intervals_client_id = config.get().INTERVALS_CLIENT_ID;
    };

    // Local storage wrapper for developer key (used by the dev-key flow)
    const devKeyStorage = LocalStorageItem({ key: 'intervals.dev.key', fallback: '' });

    // Build Basic auth header: username is literally "API_KEY" and password is the key
    function buildDevKeyAuthHeader(devKey) {
        let authHeader = '';
        try {
            const token = `API_KEY:${devKey}`;
            // btoa is available in browser; fallback to window.atob inverse if needed
            authHeader = 'Basic ' + (typeof btoa === 'function' ? btoa(token) : Buffer.from(token).toString('base64'));
        } catch (e) {
            console.warn('Unable to create Basic auth header for intervals dev key', e);
        }
        return authHeader;
    }

    // Step D
    async function connect() {
        const scope = 'ACTIVITY:WRITE,CALENDAR:READ,SETTINGS:READ';
        const state = stateParam.encode(serviceName);
        stateParam.store(state);

        const url =
              'https://intervals.icu/oauth/authorize' +
              '?' +
              new URLSearchParams({
                  client_id: intervals_client_id,
                  redirect_uri: pwa_uri,
                  scope,
                  state,
              }).toString();

        window.location.replace(url);
    }

    async function disconnect() {
        // TODO:
        // try {
        //     const stravaResponse = await fetch(
        //         "https://intervals.icu/api/v1/disconnect-app",
        //         {method: 'DELETE',}
        //     );
        //     console.log(`:oauth :intervals :disconnect`);
        //     const stravaBody = await stravaResponse.text();

        //     const apiResponse = await fetch(
        //         api_uri+`/api/intervals/deauthorize`,
        //         {method: 'POST', credentials: 'include',},
        //     );

        //     const apiBody = await apiResponse.text();

        //     xf.dispatch(`services`, {intervals: false});
        // } catch (e) {
        //     console.log(`:intervals :deauthorize :error `, e);
        // }

        // fallback since it seems deauthorize it supported only from
        // the Intervals.icu settings page
        await connect();
    }

    // Step 3
    async function paramsHandler(args = {}) {
        const state = args.state ?? '';
        const code = args.code ?? '';
        const scope = args.scope ?? '';

        const url = `${api_uri}/api/intervals/oauth/code` +
              '?' +
              new URLSearchParams({
                  state: state,
                  code: code,
                  scope: scope,
              })
              .toString();

        try {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
            });

            const result = await response.text();
            console.log(`:oauth :intervals :connnect`);
            xf.dispatch(`services`, {intervals: true});
            clearParams();
        } catch (e) {
            console.log(``, e);
        }
    }

    function clearParams() {
        window.history.pushState({}, document.title, window.location.pathname);
    }

    async function uploadWorkout(record) {
        // TODO implement dev key version
        const blob = record.blob;
        const workoutName = record.summary?.name ?? 'Powered by Auuki workout';
        const url = `${api_uri}/api/intervals/upload`;

        const formData = new FormData();
        formData.append('file', blob);
        formData.append('name', workoutName);

        try {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });

            if(response.ok) {
                return ':success';
            } else {
                if(response.status === 403) {
                    console.log(`:api :no-auth`);
                    xf.dispatch('action:auth', ':password:login');

                    xf.dispatch('ui:modal:error:open', DialogMsg.noAuth);
                }
                return ':fail';
            }
        } catch(error) {
            console.log(error);
            return ':fail';
        }
    }

    async function wod() {
        const oldest = isoDate();
        const newest = isoDate();
        // If developer key flow is enabled (config), fetch directly from intervals.icu API
        if(config.get().BACKEND_DISABLED) {
            return await wodDev({oldest, newest});
        }

        const url = `${api_uri}/api/intervals/events` +
              '?' +
              new URLSearchParams({
                  oldest,
                  newest,
              })
              .toString();

        try {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
            });

            if(response.ok) {
                const data = await response.json();
                xf.dispatch('action:planned', ':intervals:wod:success');
                console.log(data);
                return data.filter((item) => exists(item.workout_file_base64));
            } else {
                xf.dispatch('action:planned', ':intervals:wod:fail');
                if(response.status === 403) {
                    console.log(`:api :no-auth`);
                    xf.dispatch('action:auth', ':password:login');
                    xf.dispatch('ui:modal:error:open', DialogMsg.noAuth);
                }
                return [];
            }
        } catch(error) {
            xf.dispatch('action:planned', ':intervals:wod:fail');
            console.log(error);
            return [];
        }
    }

    // Developer-key based fetch directly to intervals.icu
    async function wodDev(args = {}) {
        const oldest = args.oldest ?? isoDate();
        const newest = args.newest ?? isoDate();
        // allow dev key to be provided via LocalStorageItem 
        const devKey = devKeyStorage.get()

        if(!devKey) {
            console.warn('intervals.wodDev: no developer key found (config or localStorage)');
            xf.dispatch('action:planned', ':intervals:wod:fail');
            return [];
        }

        // Use athlete id 0 to refer to the API key owner: GET /api/v1/athlete/0/events
        const base = `${intervals_base_uri}/athlete/0/events`;
        const url = base + '?' + new URLSearchParams({oldest, newest}).toString();

        let authHeader = buildDevKeyAuthHeader(devKey);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json',
                },
            });

            if(response.ok) {
                const data = await response.json();
                xf.dispatch('action:planned', ':intervals:wod:success');
                console.log(':intervals:wod:dev', data);

                // For events that don't include workout_file_base64, try to
                // download the workout file from intervals.icu (ZWO/MRC/ERG)
                // using the developer key and attach it as base64.
                const apiBase = 'https://intervals.icu/api/v1';

                await Promise.all(data.map(async (item) => {
                    try {
                        if(!exists(item.workout_file_base64) && exists(item.id)) {
                            // Download as ZWO by event id: /athlete/0/events/{id}/download.zwo
                            const downloadUrl = `${apiBase}/athlete/0/events/${item.id}/download.zwo`;
                            const dlResp = await fetch(downloadUrl, {
                                method: 'GET',
                                headers: {
                                    'Authorization': authHeader,
                                    'Accept': 'application/xml, text/xml, */*',
                                },
                            });

                            if(dlResp.ok) {
                                const text = await dlResp.text();
                                // convert to base64 (handle unicode safely)
                                let base64;
                                try {
                                    base64 = (typeof btoa === 'function')
                                        ? btoa(unescape(encodeURIComponent(text)))
                                        : Buffer.from(text, 'utf8').toString('base64');
                                } catch (e) {
                                    base64 = Buffer.from(text, 'utf8').toString('base64');
                                }
                                item.workout_file_base64 = base64;
                                // set a sensible filename if missing
                                if(!exists(item.workout_filename)) {
                                    item.workout_filename = `Intervals_${item.id}.zwo`;
                                }
                            } else {
                                console.warn('wodDev: failed to download workout', item.id, dlResp.status);
                            }
                        }
                    } catch (e) {
                        console.error('wodDev: error downloading workout', item.id, e);
                    }
                }));

                return data.filter((item) => exists(item.workout_file_base64));
            } else {
                xf.dispatch('action:planned', ':intervals:wod:fail');
                console.warn('intervals.wodDev failed', response.status);
                return [];
            }
        } catch (e) {
            xf.dispatch('action:planned', ':intervals:wod:fail');
            console.error('intervals.wodDev error', e);
            return [];
        }
    }

    async function wodMock() {
        const body = [{
            id: 47549572,
            start_date_local: `${isoDate()}T00:00:00`,
            category: "WORKOUT",
            name: "Intervals.icu Threshold",
            indoor: true,
            workout_filename: "Intervals_icu_Threshold.zwo",
            workout_file_base64: "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pgo8d29ya291dF9maWxlPgogICAgPGF1dGhvcj5EaW1pdGFyIE1hcmlub3Y8L2F1dGhvcj4KICAgIDxuYW1lPkludGVydmFscy5pY3UgVGhyZXNob2xkPC9uYW1lPgogICAgPGRlc2NyaXB0aW9uPjwvZGVzY3JpcHRpb24+CiAgICA8c3BvcnRUeXBlPmJpa2U8L3Nwb3J0VHlwZT4KICAgIDx0YWdzLz4KICAgIDx3b3Jrb3V0PgogICAgICAgIDxXYXJtdXAgUG93ZXJIaWdoPSIwLjYyNyIgUG93ZXJMb3c9IjAuMzg5IiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMC42MjciIER1cmF0aW9uPSI2MCIvPgogICAgICAgIDxTdGVhZHlTdGF0ZSBzaG93X2F2Zz0iMSIgUG93ZXI9IjAuOTc4IiBEdXJhdGlvbj0iMzAiLz4KICAgICAgICA8U3RlYWR5U3RhdGUgc2hvd19hdmc9IjEiIFBvd2VyPSIwLjUiIER1cmF0aW9uPSIzMCIvPgogICAgICAgIDxTdGVhZHlTdGF0ZSBzaG93X2F2Zz0iMSIgUG93ZXI9IjAuOTc4IiBEdXJhdGlvbj0iMzAiLz4KICAgICAgICA8U3RlYWR5U3RhdGUgc2hvd19hdmc9IjEiIFBvd2VyPSIwLjUiIER1cmF0aW9uPSIzMCIvPgogICAgICAgIDxTdGVhZHlTdGF0ZSBzaG93X2F2Zz0iMSIgUG93ZXI9IjAuNTU5IiBEdXJhdGlvbj0iMTIwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMS4wIiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMC41IiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMS4wIiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMC41IiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMS4wIiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMC41IiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMS4wIiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMC41IiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMS4wIiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPFN0ZWFkeVN0YXRlIHNob3dfYXZnPSIxIiBQb3dlcj0iMC41IiBEdXJhdGlvbj0iMzAwIi8+CiAgICAgICAgPENvb2xkb3duIFBvd2VySGlnaD0iMC4zODkiIFBvd2VyTG93PSIwLjUiIER1cmF0aW9uPSIzMDAiLz4KICAgIDwvd29ya291dD4KPC93b3Jrb3V0X2ZpbGU+Cg==" }
        ];

        return body;
    }


    // {
    //     weight: Int,
    //     icu_weight: Int,
    //     icu_weight_sync: String,
    //     sportSettings: [{
    //         types: [String],
    //         ftp: Int,
    //         indoor_ftp: Int,
    //         lthr: Int,
    //         max_hr: Int,
    //     }]
    // }
    // ->
    // { weight: Int, ftp: Int }
    function athleteToSettings(athlete = {}, defaults = {weight: 0, ftp: 0}) {
        const sportSettings = athlete.sportSettings ?? [];
        const weight = athlete.weight ?? athlete.icu_weight ?? defaults.weight;
        let ftp = defaults.ftp;

        let rideSetting;
        let virtualRideSetting;

        for(let sportSetting of sportSettings) {
            const types = sportSetting.types;

            for(let type of types) {
                if(type === "VirtualRide") {
                    virtualRideSetting = sportSetting;
                }
                if(type === "Ride") {
                    rideSetting = sportSetting;
                }
            }
        }

        if(virtualRideSetting) {
            ftp = virtualRideSetting.indoor_ftp ?? virtualRideSetting.ftp ?? defaults.ftp;
            return {weight, ftp};
        }
        if(rideSetting) {
            ftp = rideSetting.indoor_ftp ?? rideSetting.ftp ?? 0;
            return {weight, ftp};
        }

        return {weight, ftp};
    }

    async function getAthlete() {
        // If developer key flow enabled, fetch athlete directly from intervals.icu
        if(config.get().BACKEND_DISABLED) {
            return await getAthleteDev();
        }

        // GET /api/v1/athlete/{id}
        //
        // Weight is icu_weight (in kg).
        // The FTP is per sport (sportSettings array).
        // Search for one with types field containing ‘Ride’ or ‘VirtualRide’.
        // Then check ‘indoor_ftp’ (might be null) and ‘ftp’.
        // {
        //     weight: Int,
        //     icu_weight: Int,
        //     icu_weight_sync: String,
        //     sportSettings: [{
        //         types: [String]
        //         ftp: Int,
        //         indoor_ftp: Int,
        //         lthr: Int,
        //         max_hr: Int,
        //     }]
        // }
        const url = `${api_uri}/api/intervals/athlete`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
            });

            if(response.ok) {
                const data = await response.json();
                xf.dispatch('action:athlete', ':intervals:athlete:success');
                console.log(data);
                return athleteToSettings(data);
            } else {
                xf.dispatch('action:athlete', ':intervals:athlete:fail');
                if(response.status === 403) {
                    console.log(`:api :no-auth`);
                    xf.dispatch('action:auth', ':password:login');
                    xf.dispatch('ui:modal:error:open', DialogMsg.noAuth);
                }
                return athleteToSettings();
            }
        } catch(error) {
            xf.dispatch('action:athlete', ':intervals:athlete:fail');
            console.log(error);
            return athleteToSettings();
        }
    }

    // Developer-key based getAthlete
    async function getAthleteDev() {
        // Use athlete id 0 to refer to the API key owner
        const devKey = devKeyStorage.get()
        const url = `${intervals_base_uri}/athlete/0`;

        if(!devKey) {
            console.warn('intervals.getAthleteDev: no developer key found (config or localStorage)');
            xf.dispatch('action:athlete', ':intervals:athlete:fail');
            return athleteToSettings();
        }

        let authHeader = buildDevKeyAuthHeader(devKey);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json',
                },
            });

            if(response.ok) {
                const data = await response.json();
                xf.dispatch('action:athlete', ':intervals:athlete:success');
                console.log(':intervals:getAthlete:dev', data);
                return athleteToSettings(data);
            } else {
                xf.dispatch('action:athlete', ':intervals:athlete:fail');
                if(response.status === 403) {
                    console.log(`:api :no-auth`);
                    xf.dispatch('action:auth', ':password:login');
                    xf.dispatch('ui:modal:error:open', DialogMsg.noAuth);
                }
                return athleteToSettings();
            }
        } catch (error) {
            xf.dispatch('action:athlete', ':intervals:athlete:fail');
            console.log(error);
            return athleteToSettings();
        }
    }

    return Object.freeze({
        connect,
        disconnect,
        paramsHandler,
        uploadWorkout,
        update,
        wod,
        getAthlete,
        athleteToSettings,

        wodMock,
    });
}

const intervals = Intervals();

export default intervals;

