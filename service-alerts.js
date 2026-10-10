import bindings from "https://esm.sh/gtfs-realtime-bindings@1.1.1?bundle";

const { transit_realtime: transitRealtime } = bindings;
const latestLoadByContainer = new WeakMap();

function alertText(value) {
  const markup = value?.translation?.map((translation) => translation.text).filter(Boolean).join(" ") || "";
  return (new DOMParser().parseFromString(markup, "text/html").body.textContent || "")
    .replace(/\s+/g, " ").trim();
}

function isCritical(alert) {
  return [1, 3].includes(alert.effect) || Number(alert.severityLevel) >= 3;
}

function makeNotice(titleText, messageText, className = "service-alert-status") {
  const notice = document.createElement("div");
  notice.className = className;
  const title = document.createElement("strong");
  title.textContent = titleText;
  const message = document.createElement("span");
  message.textContent = messageText;
  notice.append(title, message);
  return notice;
}

function isActive(alert, nowSeconds) {
  const periods = alert.activePeriod || [];
  return periods.length === 0 || periods.some((period) => {
    const startsInFuture = period.start !== undefined && Number(period.start) > nowSeconds;
    const hasExpired = period.end !== undefined && Number(period.end) <= nowSeconds;
    return !startsInFuture && !hasExpired;
  });
}

function renderAlerts(container, alerts, emptyMessage, decorateSummary) {
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("div");
  heading.className = "service-alert-heading";
  heading.textContent = "LIVE MTA SERVICE UPDATES";
  fragment.append(heading);

  for (const alert of alerts.slice(0, 8)) {
    const details = document.createElement("details");
    details.className = `service-alert${isCritical(alert) ? " service-alert-critical" : ""}`;
    const summary = document.createElement("summary");
    summary.textContent = alertText(alert.headerText) || "Service change";
    decorateSummary(summary, alert);
    const description = document.createElement("p");
    description.textContent = alertText(alert.descriptionText)
      || "Check the MTA service status page for more details.";
    details.append(summary, description);
    fragment.append(details);
  }

  if (alerts.length === 0 && emptyMessage) {
    fragment.append(makeNotice("No active service alerts", emptyMessage));
  }
  container.replaceChildren(fragment);
  container.hidden = alerts.length === 0 && !emptyMessage;
}

export async function loadServiceAlerts(container, feedUrl, {
  matches = () => true,
  emptyMessage = null,
  decorateSummary = () => {}
} = {}) {
  const loadId = (latestLoadByContainer.get(container) || 0) + 1;
  latestLoadByContainer.set(container, loadId);
  try {
    const response = await fetch(feedUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`MTA service alerts returned ${response.status}`);
    if (latestLoadByContainer.get(container) !== loadId) return;
    const feed = transitRealtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
    if (latestLoadByContainer.get(container) !== loadId) return;
    const alerts = (feed.entity || [])
      .map((entity) => entity.alert)
      .filter((alert) => alert && isActive(alert, Date.now() / 1000) && matches(alert));
    renderAlerts(container, alerts, emptyMessage, decorateSummary);
  } catch (error) {
    if (latestLoadByContainer.get(container) !== loadId) return;
    console.error("Unable to load MTA service alerts:", error);
    const heading = document.createElement("div");
    heading.className = "service-alert-heading";
    heading.textContent = "LIVE MTA SERVICE UPDATES";
    container.replaceChildren(heading, makeNotice(
      "Live service updates unavailable",
      "Check the MTA status page or refresh to try again."
    ));
    container.hidden = false;
  }
}
