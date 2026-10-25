export const runtime = "edge";

type JsonObject = Record<string, any>;

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function secondsFrom(value: unknown) {
  const text = clean(value).replace(/^\+/, "").replace(",", ".");
  if (!text || text === "--") return 0;
  const parts = text.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(text) || 0;
}

function parseEventMetadata(html: string) {
  const script = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (script) {
    try {
      const value = JSON.parse(script);
      if (value?.["@type"] === "Event") {
        return {
          eventName: clean(value.name),
          eventDate: clean(value.startDate).slice(0, 10),
        };
      }
    } catch {
      // Fall back to the regular page metadata below.
    }
  }

  const title = clean(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1])
    .split(" : : ")[0]
    .replace(/,\s*\d{2}\/\d{2}\/\d{4}.*$/, "");
  const description = clean(
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1],
  );
  const usDate = description.match(/(\d{2})\/(\d{2})\/(\d{4})/);

  return {
    eventName: title,
    eventDate: usDate ? `${usDate[3]}-${usDate[1]}-${usDate[2]}` : "",
  };
}

function findListName(value: any): string {
  if (!value || typeof value !== "object") return "";
  if (typeof value?.Config?.List === "string") return value.Config.List;
  for (const child of Object.values(value)) {
    const result = findListName(child);
    if (result) return result;
  }
  return "";
}

function racerResultHeaders(referer: string) {
  return {
    accept: "application/json, text/plain, */*",
    referer,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36",
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sourceUrl = new URL(String(body?.url || ""));
    if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "my.raceresult.com") {
      return Response.json(
        { error: "El enlace debe pertenecer a my.raceresult.com" },
        { status: 400 },
      );
    }

    const path = sourceUrl.pathname.split("/").filter(Boolean);
    const eventId = path[0];
    const pageName = path[1];
    const pid = sourceUrl.searchParams.get("pid");
    if (!eventId || !/^\d+$/.test(eventId) || !pageName || !pid || !/^\d+$/.test(pid)) {
      return Response.json(
        { error: "El enlace no contiene una carrera y un participante válidos" },
        { status: 400 },
      );
    }

    const pageResponse = await fetch(sourceUrl.toString(), {
      headers: racerResultHeaders(sourceUrl.toString()),
    });
    if (!pageResponse.ok) throw new Error("page");
    const html = await pageResponse.text();

    // The current Race Result page initializes the widget with positional
    // arguments: element, event ID, page name, participant ID, bib, standalone.
    const widget = html.match(
      /new\s+RRParticipantView\s*\([^,]+,\s*(\d+)\s*,\s*['"]([^'"]+)['"]\s*,\s*(\d+)/i,
    );
    const resolvedEventId = widget?.[1] || eventId;
    const resolvedPage = widget?.[2] || pageName;
    const resolvedPid = widget?.[3] || pid;

    const viewUrl = new URL(
      `https://my.raceresult.com/${resolvedEventId}/${resolvedPage}/view`,
    );
    viewUrl.searchParams.set("lang", "en");
    viewUrl.searchParams.set("mid", "0");
    viewUrl.searchParams.set("standalone", "true");
    viewUrl.searchParams.set("pid", resolvedPid);

    const viewResponse = await fetch(viewUrl, {
      headers: racerResultHeaders(sourceUrl.toString()),
    });
    if (!viewResponse.ok) throw new Error("participant");
    const view: JsonObject = await viewResponse.json();

    // Race Result currently wraps the participant payload in `Data`, while
    // older events can expose the same properties at the response root.
    const participantView =
      view?.Data?.Elements || view?.Data?.Data ? view.Data : view;

    const legs = Array.isArray(participantView?.SplitsAndLegs?.Legs)
      ? participantView.SplitsAndLegs.Legs
      : [];
    const basicSplits = legs
      .filter((leg: JsonObject) => leg?.Exists !== false)
      .map((leg: JsonObject) => ({
        name: clean(leg.Name),
        seconds: Math.round(secondsFrom(leg.Time)),
      }))
      .filter((split: { name: string; seconds: number }) => split.name && split.seconds > 0);

    const missingLaps = (
      Array.isArray(participantView?.SplitsAndLegs?.Splits)
        ? participantView.SplitsAndLegs.Splits
        : []
    ).filter(
      (split: JsonObject) =>
        split?.Exists === false && /run\s*\d+.*lp\s*\d+/i.test(clean(split.Name)),
    );

    const listName = findListName(participantView?.Elements);
    let listData: JsonObject | null =
      listName && participantView?.Data?.Lists?.[listName]
        ? participantView.Data.Lists[listName]
        : null;
    const server = clean(participantView?.Server);
    const listHost =
      server && /(^|\.)raceresult\.com$/i.test(server)
        ? `https://${server}`
        : "https://my.raceresult.com";

    // Some older events only return the list configuration in /view and need
    // a second request. Newer events embed the complete list in Data.Lists.
    if (!listData && listName && participantView?.key) {
      const listUrl = new URL(
        `${listHost}/${resolvedEventId}/${resolvedPage}/list`,
      );
      listUrl.searchParams.set("key", String(participantView.key));
      listUrl.searchParams.set("listname", listName);
      listUrl.searchParams.set("page", resolvedPage);
      listUrl.searchParams.set("r", "pid");
      listUrl.searchParams.set("pid", resolvedPid);

      const listResponse = await fetch(listUrl, {
        headers: racerResultHeaders(sourceUrl.toString()),
      });
      if (listResponse.ok) listData = await listResponse.json();
    }

    const fields: string[] = Array.isArray(listData?.DataFields)
      ? listData!.DataFields
      : [];
    const listRows = Array.isArray(listData?.Data)
      ? listData.Data
      : Array.isArray(listData?.data)
        ? listData.data
        : [];
    const row: unknown[] = Array.isArray(listRows[0])
      ? listRows[0]
      : [];
    const valueAt = (matcher: (field: string) => boolean) => {
      const index = fields.findIndex(matcher);
      return index >= 0 ? clean(row[index]) : "";
    };

    const detailedSplits = fields
      .map((field, index) =>
        /\.LABEL$/i.test(field) && index + 1 < row.length
          ? {
              name: clean(row[index]),
              seconds: Math.round(secondsFrom(row[index + 1])),
            }
          : null,
      )
      .filter(
        (split): split is { name: string; seconds: number } =>
          Boolean(split?.name && split.seconds > 0),
      );

    const penaltyText = valueAt((field) => /PenaltyNotesTotal/i.test(field))
      .replace(/^Penalty:\s*/i, "")
      .trim();
    const penaltyFromList = secondsFrom(
      valueAt((field) => /PenaltyTimeTotal/i.test(field)),
    );
    const penaltySeconds = Math.round(
      penaltyFromList || missingLaps.length * 120,
    );
    const missingRuns = [
      ...new Set(
        missingLaps
          .map((split: JsonObject) => clean(split.Name).match(/run\s*(\d+)/i)?.[1])
          .filter(Boolean),
      ),
    ];

    const totalSeconds = Math.round(
      secondsFrom(valueAt((field) => /FinalTime\.DECIMAL/i.test(field))) ||
        secondsFrom(valueAt((field) => /Finish\.DECIMAL/i.test(field))) ||
        detailedSplits.reduce((sum, split) => sum + split.seconds, 0) +
          penaltySeconds,
    );
    const category = valueAt((field) =>
      /"Category:\s*"|RaceCat/i.test(field),
    ).replace(/^Category:\s*/i, "");
    const participant =
      clean(row[2]) ||
      valueAt((field) => /DisplayName|TeamName/i.test(field));
    const metadata = parseEventMetadata(html);

    if (!totalSeconds || !(detailedSplits.length || basicSplits.length)) {
      return Response.json(
        {
          error:
            "Race Result respondió, pero no publicó tiempos para este participante.",
        },
        { status: 422 },
      );
    }

    return Response.json({
      eventName:
        metadata.eventName ||
        clean(listData?.List?.HeadLine1 || listData?.list?.HeadLine1) ||
        `Carrera ${eventId}`,
      eventDate: metadata.eventDate,
      format: /DEKA/i.test(metadata.eventName) ? "DEKA FIT" : "",
      participant,
      bib: clean(row[0]) || resolvedPid,
      category,
      totalSeconds,
      penaltySeconds,
      penaltyNote:
        penaltyText ||
        (missingRuns.length
          ? `Vuelta omitida en Run ${missingRuns.join(", Run ")}`
          : ""),
      splits: detailedSplits.length ? detailedSplits : basicSplits,
    });
  } catch {
    return Response.json(
      {
        error:
          "No se pudo importar el resultado. Comprueba que el enlace sea público e inténtalo de nuevo.",
      },
      { status: 500 },
    );
  }
}
