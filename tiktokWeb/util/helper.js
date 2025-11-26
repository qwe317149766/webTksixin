function getTimestampByTimezone(timezone) {
    const date = new Date(
        new Date().toLocaleString("en-US", { timeZone: timezone })
    );
    return Math.floor(date.getTime() / 1000);
}

// 根据 lang 获取 locale、accept-language、以及国家首都时区 tz_name
function buildHeadersByLang(lang = "en") {
    const langMap = {
        "en":    { locale: "en-US", tz: "America/New_York", value: "en-US,en;q=0.9" },
        "en-us": { locale: "en-US", tz: "America/New_York", value: "en-US,en;q=0.9" },
        "en-gb": { locale: "en-GB", tz: "Europe/London",   value: "en-GB,en;q=0.9" },

        "zh":    { locale: "zh-CN", tz: "Asia/Shanghai", value: "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7" },
        "zh-cn": { locale: "zh-CN", tz: "Asia/Shanghai", value: "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7" },
        "zh-tw": { locale: "zh-TW", tz: "Asia/Taipei",   value: "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7" },

        "ja":    { locale: "ja-JP", tz: "Asia/Tokyo",     value: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" },
        "ko":    { locale: "ko-KR", tz: "Asia/Seoul",     value: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7" },

        "vi":    { locale: "vi-VN", tz: "Asia/Ho_Chi_Minh", value: "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7" },
        "th":    { locale: "th-TH", tz: "Asia/Bangkok",     value: "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7" },
        "id":    { locale: "id-ID", tz: "Asia/Jakarta",     value: "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7" },
        "ms":    { locale: "ms-MY", tz: "Asia/Kuala_Lumpur", value: "ms-MY,ms;q=0.9,en-US;q=0.8,en;q=0.7" },
        "my":    { locale: "my-MM", tz: "Asia/Yangon",     value: "my-MM,my;q=0.9,en-US;q=0.8,en;q=0.7" },
        "fil":   { locale: "fil-PH", tz: "Asia/Manila",    value: "fil-PH,fil;q=0.9,en-US;q=0.8,en;q=0.7" },

        "hi":    { locale: "hi-IN", tz: "Asia/Kolkata",    value: "hi-IN,hi;q=0.9,en-US;q=0.8,en;q=0.7" },
        "ar":    { locale: "ar-SA", tz: "Asia/Riyadh",     value: "ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7" },
        "es":    { locale: "es-ES", tz: "Europe/Madrid",    value: "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7" },
        "pt-br": { locale: "pt-BR", tz: "America/Sao_Paulo", value: "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7" },
        "ru":    { locale: "ru-RU", tz: "Europe/Moscow",   value: "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7" },
        "de":    { locale: "de-DE", tz: "Europe/Berlin",   value: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7" },
        "fr":    { locale: "fr-FR", tz: "Europe/Paris",    value: "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7" },
        "it":    { locale: "it-IT", tz: "Europe/Rome",     value: "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7" }
    };

    lang = lang.toLowerCase();
    const final = langMap[lang] || langMap["en"];

    return {
        headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            "accept-language": final.value
        },
        locale: final.locale,
        tz_name: final.tz
    };
}

  
module.exports ={
    getTimestampByTimezone,
    buildHeadersByLang
}