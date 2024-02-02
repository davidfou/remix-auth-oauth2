"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuth2Strategy = void 0;
const server_runtime_1 = require("@remix-run/server-runtime");
const debug_1 = __importDefault(require("debug"));
const remix_auth_1 = require("remix-auth");
const uuid_1 = require("uuid");
let debug = (0, debug_1.default)("OAuth2Strategy");
/**
 * The OAuth 2.0 authentication strategy authenticates requests using the OAuth
 * 2.0 framework.
 *
 * OAuth 2.0 provides a facility for delegated authentication, whereby users can
 * authenticate using a third-party service such as Facebook.  Delegating in
 * this manner involves a sequence of events, including redirecting the user to
 * the third-party service for authorization.  Once authorization has been
 * granted, the user is redirected back to the application and an authorization
 * code can be used to obtain credentials.
 *
 * Applications must supply a `verify` callback, for which the function
 * signature is:
 *
 *     function(accessToken, refreshToken, profile) { ... }
 *
 * The verify callback is responsible for finding or creating the user, and
 * returning the resulting user object.
 *
 * An AuthorizationError should be raised to indicate an authentication failure.
 *
 * Options:
 * - `authorizationURL`  URL used to obtain an authorization grant
 * - `tokenURL`          URL used to obtain an access token
 * - `clientID`          identifies client to service provider
 * - `clientSecret`      secret used to establish ownership of the client identifier
 * - `callbackURL`       URL to which the service provider will redirect the user after obtaining authorization
 * - `allowReauth`       allow a user to be reauthenticated if they are already logged in. Useful for prompting for extra permissions or scopes after login.
 *
 * @example
 * authenticator.use(new OAuth2Strategy(
 *   {
 *     authorizationURL: 'https://www.example.com/oauth2/authorize',
 *     tokenURL: 'https://www.example.com/oauth2/token',
 *     clientID: '123-456-789',
 *     clientSecret: 'shhh-its-a-secret'
 *     callbackURL: 'https://www.example.net/auth/example/callback'
 *   },
 *   async ({ accessToken, refreshToken, profile }) => {
 *     return await User.findOrCreate(...);
 *   }
 * ));
 */
class OAuth2Strategy extends remix_auth_1.Strategy {
    constructor(options, verify) {
        var _a, _b, _c;
        super(verify);
        this.name = "oauth2";
        this.sessionStateKey = "oauth2:state";
        this.authorizationURL = options.authorizationURL;
        this.tokenURL = options.tokenURL;
        this.clientID = options.clientID;
        this.clientSecret = options.clientSecret;
        this.callbackURL = options.callbackURL;
        this.scope = options.scope;
        this.responseType = (_a = options.responseType) !== null && _a !== void 0 ? _a : "code";
        this.useBasicAuthenticationHeader =
            (_b = options.useBasicAuthenticationHeader) !== null && _b !== void 0 ? _b : false;
        this.allowReauth = (_c = options.allowReauth) !== null && _c !== void 0 ? _c : false;
    }
    async authenticate(request, sessionStorage, options) {
        var _a;
        debug("Request URL", request.url);
        let url = new URL(request.url);
        let session = await sessionStorage.getSession(request.headers.get("Cookie"));
        let user = (_a = session.get(options.sessionKey)) !== null && _a !== void 0 ? _a : null;
        // User is already authenticated
        if (user && !this.allowReauth) {
            debug("User is authenticated");
            return this.success(user, request, sessionStorage, options);
        }
        let callbackURL = this.getCallbackURL(request);
        debug("Callback URL", callbackURL);
        // Redirect the user to the callback URL
        if (url.pathname !== callbackURL.pathname) {
            debug("Redirecting to callback URL");
            let state = this.generateState();
            debug("State", state);
            session.set(this.sessionStateKey, state);
            throw (0, server_runtime_1.redirect)(this.getAuthorizationURL(request, state).toString(), {
                headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
            });
        }
        // Validations of the callback URL params
        let stateUrl = url.searchParams.get("state");
        debug("State from URL", stateUrl);
        if (!stateUrl) {
            return await this.failure("Missing state on URL.", request, sessionStorage, options, new Error("Missing state on URL."));
        }
        let stateSession = session.get(this.sessionStateKey);
        debug("State from session", stateSession);
        if (!stateSession) {
            return await this.failure("Missing state on session.", request, sessionStorage, options, new Error("Missing state on session."));
        }
        if (stateSession === stateUrl) {
            debug("State is valid");
            session.unset(this.sessionStateKey);
        }
        else {
            return await this.failure("State doesn't match.", request, sessionStorage, options, new Error("State doesn't match."));
        }
        let code = url.searchParams.get("code");
        if (!code) {
            return await this.failure("Missing code.", request, sessionStorage, options, new Error("Missing code."));
        }
        try {
            // Get the access token
            let params = new URLSearchParams(this.tokenParams());
            params.set("grant_type", "authorization_code");
            params.set("redirect_uri", callbackURL.toString());
            let { accessToken, refreshToken, extraParams } = await this.fetchAccessToken(code, params);
            // Get the profile
            let profile = await this.userProfile(accessToken, extraParams);
            // Verify the user and return it, or redirect
            user = await this.verify({
                accessToken,
                refreshToken,
                extraParams,
                profile,
                context: options.context,
                request,
            });
        }
        catch (error) {
            debug("Failed to verify user", error);
            // Allow responses to pass-through
            if (error instanceof Response)
                throw error;
            if (error instanceof Error) {
                return await this.failure(error.message, request, sessionStorage, options, error);
            }
            if (typeof error === "string") {
                return await this.failure(error, request, sessionStorage, options, new Error(error));
            }
            return await this.failure("Unknown error", request, sessionStorage, options, new Error(JSON.stringify(error, null, 2)));
        }
        debug("User authenticated");
        return await this.success(user, request, sessionStorage, options);
    }
    /**
     * Retrieve user profile from service provider.
     *
     * OAuth 2.0-based authentication strategies can override this function in
     * order to load the user's profile from the service provider.  This assists
     * applications (and users of those applications) in the initial registration
     * process by automatically submitting required information.
     */
    async userProfile(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    accessToken, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    params) {
        return { provider: "oauth2" };
    }
    /**
     * Return extra parameters to be included in the authorization request.
     *
     * Some OAuth 2.0 providers allow additional, non-standard parameters to be
     * included when requesting authorization.  Since these parameters are not
     * standardized by the OAuth 2.0 specification, OAuth 2.0-based authentication
     * strategies can override this function in order to populate these
     * parameters as required by the provider.
     */
    authorizationParams(params) {
        return new URLSearchParams(params);
    }
    /**
     * Return extra parameters to be included in the token request.
     *
     * Some OAuth 2.0 providers allow additional, non-standard parameters to be
     * included when requesting an access token.  Since these parameters are not
     * standardized by the OAuth 2.0 specification, OAuth 2.0-based authentication
     * strategies can override this function in order to populate these
     * parameters as required by the provider.
     */
    tokenParams() {
        return new URLSearchParams();
    }
    async getAccessToken(response) {
        let { access_token, refresh_token, ...extraParams } = await response.json();
        return {
            accessToken: access_token,
            refreshToken: refresh_token,
            extraParams,
        };
    }
    getCallbackURL(request) {
        var _a, _b;
        if (this.callbackURL.startsWith("http:") ||
            this.callbackURL.startsWith("https:")) {
            return new URL(this.callbackURL);
        }
        let host = (_b = (_a = request.headers.get("X-Forwarded-Host")) !== null && _a !== void 0 ? _a : request.headers.get("host")) !== null && _b !== void 0 ? _b : new URL(request.url).host;
        let protocol = host.includes("localhost") ? "http" : "https";
        if (this.callbackURL.startsWith("/")) {
            return new URL(this.callbackURL, `${protocol}://${host}`);
        }
        return new URL(`${protocol}//${this.callbackURL}`);
    }
    getAuthorizationURL(request, state) {
        let params = new URLSearchParams(this.authorizationParams(new URL(request.url).searchParams));
        params.set("response_type", this.responseType);
        params.set("client_id", this.clientID);
        params.set("redirect_uri", this.getCallbackURL(request).toString());
        params.set("state", state);
        // We need to check if `authorizationParams` has not set scopes to avoid regressions on dependent libraries
        if (!params.has("scope") && this.scope) {
            params.set("scope", this.scope);
        }
        let url = new URL(this.authorizationURL);
        url.search = params.toString();
        return url;
    }
    generateState() {
        return (0, uuid_1.v4)();
    }
    /**
     * Format the data to be sent in the request body to the token endpoint.
     */
    async fetchAccessToken(code, params) {
        let headers = {
            "Content-Type": "application/x-www-form-urlencoded",
        };
        if (this.useBasicAuthenticationHeader) {
            const b64EncodedCredentials = Buffer.from(`${this.clientID}:${this.clientSecret}`).toString("base64");
            headers = {
                ...headers,
                Authorization: `Basic ${b64EncodedCredentials}`,
            };
        }
        else {
            params.set("client_id", this.clientID);
            params.set("client_secret", this.clientSecret);
        }
        if (params.get("grant_type") === "refresh_token") {
            params.set("refresh_token", code);
        }
        else {
            params.set("code", code);
        }
        let response = await fetch(this.tokenURL, {
            method: "POST",
            headers,
            body: params,
        });
        if (!response.ok) {
            let body = await response.text();
            throw body;
        }
        return await this.getAccessToken(response.clone());
    }
}
exports.OAuth2Strategy = OAuth2Strategy;
