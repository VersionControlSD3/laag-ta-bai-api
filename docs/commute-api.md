# Local commute navigation

`POST /v1/commute` accepts `origin: { latitude, longitude }` and
`destinationLandmarkId`. Destination coordinates come from the landmark database.
Optional `departureTime` is an RFC 3339 timestamp. The API uses the
[Google Routes transit window](https://developers.google.com/maps/documentation/routes/transit-route)
of 7 days before through 100 days after the current time, inclusive. Omitting
it uses the current time. A timestamp outside the window returns HTTP 400
before contacting Google. Available routes still depend on the transit schedule.
Optional `preference` is `LESS_WALKING` or `FEWER_TRANSFERS`.

The Google Routes adapter requests TRANSIT and returns up to four routes containing
meters, seconds, encoded polyline, walking/transit steps, stop names, line names/codes,
arrival/departure times, agency attribution, and localized fare text where provided.
Unknown fare is `null`, not zero. Missing coverage returns `status: no_routes` and
`routes: []`; successful routing returns `status: ok`.

Setup:

1. Use the team's billing-enabled Google Cloud project and enable **Routes API**.
2. Create a server API key restricted to Routes API. Apply appropriate server-side
   application restrictions for your hosting setup. Use a separate browser key for
   Maps JavaScript API if adding a frontend map.
3. Set `GOOGLE_MAPS_API_KEY` in the backend `.env` and restart the server.
4. In deployments, set it in the backend hosting environment. Never put it in a `VITE_` variable.
5. Run the example and verify actual coverage for the team's Cebu test locations.

Example after starting the backend:

```powershell
$body = @{
    origin = @{ latitude = 10.3181; longitude = 123.9051 }
    destinationLandmarkId = 'fort-san-pedro'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/v1/commute' `
    -ContentType 'application/json' -Body $body
```

Google's coverage determines available transit services, codes and fares. This
implementation never invents Cebu jeepney data. If local coverage is insufficient,
a verified local transit dataset/provider is a separate dependency. Driving directions
must not be presented as public transit. Live requests may incur Maps usage charges.

Missing key: 503 `commute_unavailable`. Provider rejection or malformed response: 502.
Network/provider unavailability: 503. Timeout: 504 (10 seconds). Rate limit: 20 requests
per minute per IP, per server instance. Provider error details are not exposed.
Origins are forwarded to Google and are not persisted by this handler.

A commute screen/map renderer is outside this backend-only scope. The frontend team
can consume the documented JSON contract. Display the required Google attribution
and returned transit agency attribution when rendering directions, following Google's policies.

References:

- [Transit requests](https://developers.google.com/maps/documentation/routes/transit-route)
- [Compute Routes reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes)
- [Google Cloud setup](https://developers.google.com/maps/documentation/routes/cloud-setup)
- [Routes policies](https://developers.google.com/maps/documentation/routes/policies)
