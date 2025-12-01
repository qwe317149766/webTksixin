/**
 * 完全从 protobufEncode.js 提取的 t$ 函数
 * 不修改任何原始算法，完全使用原始代码
 */

const protobuf = require('protobufjs');
const Long = require('long');

// 使用 Node.js 内置 crypto 生成 UUID，避免 ESM/require 冲突
const { randomUUID } = require('crypto');
const uuidv4 = () => randomUUID();
// 创建 protobuf root
const root = protobuf.Root.fromJSON({
    nested: {
        im_proto: {
            nested: {
                Request: {
                    fields: {
                        cmd: { type: "int32", id: 1 },
                        sequence_id: { type: "int64", id: 2 },
                        sdk_version: { type: "string", id: 3 },
                        token: { type: "string", id: 4 },
                        refer: { type: "int32", id: 5 },
                        inbox_type: { type: "int32", id: 6 },
                        build_number: { type: "string", id: 7 },
                        body: { type: "RequestBody", id: 8 },
                        device_id: { type: "string", id: 9 },
                        channel: { type: "string", id: 10 },
                        device_platform: { type: "string", id: 11 },
                        device_type: { type: "string", id: 12 },
                        os_version: { type: "string", id: 13 },
                        version_code: { type: "string", id: 14 },
                        headers: { type: "string", id: 15, rule: "repeated", options: { proto3_optional: false }, keyType: "string" },
                        config_id: { type: "int32", id: 16 },
                        token_info: { type: "TokenInfo", id: 17 },
                        auth_type: { type: "int32", id: 18 },
                        msg_trace: { type: "MsgTrace", id: 19 },
                        retry_count: { type: "int32", id: 20 }
                    }
                },
                Response: {
                    fields: {
                        cmd: { type: "int32", id: 1 },
                        sequence_id: { type: "int64", id: 2 },
                        status_code: { type: "int32", id: 3 },
                        error_desc: { type: "string", id: 4 },
                        inbox_type: { type: "int32", id: 5 },
                        body: { type: "ResponseBody", id: 6 },
                        log_id: { type: "string", id: 7 },
                        headers: { type: "string", id: 8, rule: "repeated", options: { proto3_optional: false }, keyType: "string" },
                        start_time_stamp: { type: "int64", id: 9 },
                        request_arrived_time: { type: "int64", id: 10 },
                        server_execution_end_time: { type: "int64", id: 11 },
                        retry_count: { type: "int32", id: 12 },
                        server_start_time: { type: "int64", id: 13 },
                        region: { type: "string", id: 14 }
                    }
                },
                RequestBody: {
                    fields: {
                        send_message_body: { type: "SendMessageRequestBody", id: 100 },
                        create_conversation_v2_body: { type: "CreateConversationV2RequestBody", id: 609 },
                        delete_message_body: { type: "DeleteMessageRequestBody", id: 5610 },
                        messages_per_user_body: { type: "MessagesPerUserRequestBody", id: 200 },
                        messages_per_user_init_body: { type: "MessagesPerUserInitRequestBody", id: 201 },
                        messages_per_user_init_v2_body: { type: "MessagesPerUserInitV2RequestBody", id: 203 },
                        messages_per_user_combo_body: { type: "MessagesPerUserComboRequestBody", id: 204 },
                        messages_per_conversation_search_body: { type: "MessagesPerConversationSearchRequestBody", id: 206 },
                        check_messages_per_user_body: { type: "CheckMessagePerUserRequestBody", id: 210 },
                        get_message_by_id_body: { type: "GetMessageByIdRequestBody", id: 211 },
                        conversations_list_body: { type: "ConversationsListRequestBody", id: 300 },
                        messages_in_conversation_body: { type: "MessagesInConversationRequestBody", id: 301 },
                        get_messages_checkinfo_in_conversation_body: { type: "GetMessagesCheckInfoInConversationRequestBody", id: 302 },
                        get_messages_check_info_v2_body: { type: "GetMessagesCheckInfoV2RequestBody", id: 303 },
                        messages_in_conversation_with_range: { type: "MessagesInConversationWithRangeRequestBody", id: 304 },
                        send_user_action_body: { type: "SendUserActionRequestBody", id: 410 },
                        send_input_status_body: { type: "SendInputStatusRequestBody", id: 411 },
                        get_conversation_info_body: { type: "GetConversationInfoRequestBody", id: 600 },
                        set_conversation_info_body: { type: "SetConversationInfoRequestBody", id: 601 },
                        create_conversation_body: { type: "CreateConversationRequestBody", id: 700 },
                        mark_read_body: { type: "MarkConversationReadRequestBody", id: 800 },
                        mark_unread_body: { type: "MarkConversationUnreadRequestBody", id: 801 },
                        batch_mark_read_body: { type: "BatchMarkConversationReadRequestBody", id: 802 },
                        delete_conversation_body: { type: "DeleteConversationRequestBody", id: 900 },
                        get_stranger_conversation_list_body: { type: "GetStrangerConversationListRequestBody", id: 1000 }
                    }
                },
                ResponseBody: {
                    fields: {
                        send_message_body: { type: "SendMessageResponseBody", id: 100 },
                        create_conversation_v2_body: { type: "CreateConversationV2ResponseBody", id: 609 }
                    }
                },
                SendMessageResponseBody: {
                    fields: {
                        server_message_id: { type: "int64", id: 1 },
                        extra_info: { type: "string", id: 2 },
                        status: { type: "int32", id: 3 },
                        client_message_id: { type: "string", id: 4 },
                        check_code: { type: "int64", id: 5 },
                        check_message: { type: "string", id: 6 },
                        filtered_content: { type: "string", id: 7 },
                        is_async_send: { type: "bool", id: 8 },
                        new_ticket: { type: "string", id: 9 },
                        conversation: { type: "ConversationInfoV2", id: 10 },
                        inboxPageCategory: { type: "int32", id: 12 },
                        filter_reason: { type: "int32", id: 13 }
                    }
                },
                ConversationInfoV2: {
                    fields: {
                        conversation_id: { type: "string", id: 1 },
                        conversation_short_id: { type: "int64", id: 2 },
                        conversation_type: { type: "int32", id: 3 },
                        ticket: { type: "string", id: 4 },
                        first_page_participants: { type: "ParticipantsPage", id: 6 },
                        participants_count: { type: "int32", id: 7 },
                        is_participant: { type: "bool", id: 8 },
                        inbox_type: { type: "int32", id: 9 },
                        badge_count: { type: "int32", id: 10 },
                        badge_count_v2: { type: "int32", id: 11 },
                        conversation_rank_version: { type: "int64", id: 12 },
                        user_info: { type: "Participant", id: 20 },
                        conversation_core_info: { type: "ConversationCoreInfo", id: 50 },
                        conversation_setting_info: { type: "ConversationSettingInfo", id: 51 },
                        biz_ext: { type: "bytes", id: 100 }
                    }
                },
                ParticipantsPage: {
                    fields: {}
                },
                Participant: {
                    fields: {}
                },
                ConversationCoreInfo: {
                    fields: {}
                },
                ConversationSettingInfo: {
                    fields: {}
                },
                CreateConversationV2ResponseBody: {
                    fields: {
                        conversation: { type: "ConversationInfoV2", id: 1 },
                        check_code: { type: "int64", id: 2 },
                        check_message: { type: "string", id: 3 },
                        extra_info: { type: "string", id: 4 },
                        status: { type: "int32", id: 5 }
                    }
                },
                SendMessageRequestBody: {
                    fields: {
                        conversation_id: { type: "string", id: 1 },
                        conversation_type: { type: "int32", id: 2 },
                        conversation_short_id: { type: "int64", id: 3 },
                        content: { type: "string", id: 4 },
                        ext: { type: "string", id: 5, rule: "repeated", keyType: "string" },
                        message_type: { type: "int32", id: 6 },
                        ticket: { type: "string", id: 7 },
                        client_message_id: { type: "string", id: 8 },
                        mentioned_users: { type: "int64", id: 9, rule: "repeated" },
                        ignore_badge_count: { type: "bool", id: 10 },
                        send_media_list: { type: "SendMediaRequest", id: 17, rule: "repeated" }
                    }
                },
                SendMediaRequest: {
                    fields: {}
                },
                TokenInfo: {
                    fields: {
                        value: { type: "int32", id: 1 }
                    }
                },
                MsgTrace: {
                    fields: {
                        value: { type: "int32", id: 1 }
                    }
                },
                // 其他 RequestBody 类型定义
                MessagesPerUserRequestBody: {
                    fields: {}
                },
                MessagesPerUserInitRequestBody: {
                    fields: {}
                },
                MessagesPerUserInitV2RequestBody: {
                    fields: {}
                },
                MessagesPerUserComboRequestBody: {
                    fields: {}
                },
                MessagesPerConversationSearchRequestBody: {
                    fields: {}
                },
                CheckMessagePerUserRequestBody: {
                    fields: {}
                },
                GetMessageByIdRequestBody: {
                    fields: {}
                },
                ConversationsListRequestBody: {
                    fields: {}
                },
                MessagesInConversationRequestBody: {
                    fields: {}
                },
                GetMessagesCheckInfoInConversationRequestBody: {
                    fields: {}
                },
                GetMessagesCheckInfoV2RequestBody: {
                    fields: {}
                },
                MessagesInConversationWithRangeRequestBody: {
                    fields: {}
                },
                SendUserActionRequestBody: {
                    fields: {}
                },
                SendInputStatusRequestBody: {
                    fields: {}
                },
                GetConversationInfoRequestBody: {
                    fields: {}
                },
                SetConversationInfoRequestBody: {
                    fields: {}
                },
                DeleteMessageRequestBody: {
                    fields: {
                        conversation_id: { type: "string", id: 1 },
                        conversation_short_id: { type: "int64", id: 2 },
                        conversation_type: { type: "int32", id: 3 },
                        message_id: { type: "int64", id: 4 }
                    }
                },
                CreateConversationRequestBody: {
                    fields: {}
                },
                CreateConversationV2RequestBody: {
                    fields: {
                        conversation_type: { type: "int32", id: 1 },
                        participants: { type: "int64", id: 2, rule: "repeated", options: { packed: false } },
                        persistent: { type: "bool", id: 3 },
                        idempotent_id: { type: "string", id: 4 },
                        name: { type: "string", id: 6 },
                        avatar_url: { type: "string", id: 7 },
                        description: { type: "string", id: 8 },
                        biz_ext: { type: "string", id: 11, rule: "repeated", options: { proto3_optional: false }, keyType: "string" },
                        biz: { type: "string", id: 12 },
                        channel: { type: "string", id: 13 }
                    }
                },
                MarkConversationReadRequestBody: {
                    fields: {}
                },
                MarkConversationUnreadRequestBody: {
                    fields: {}
                },
                BatchMarkConversationReadRequestBody: {
                    fields: {}
                },
                DeleteConversationRequestBody: {
                    fields: {}
                },
                GetStrangerConversationListRequestBody: {
                    fields: {}
                },
                // PictureCard 相关定义 卡片消息
                PictureCard: {
                    fields: {
                        image: { type: "BaseImage", id: 1 },
                        thumbnail: { type: "BaseImage", id: 2 },
                        preview_hint: { type: "PreviewHint", id: 3 },
                        link_info: { type: "LinkInfo", id: 4 },
                        fallback: { type: "PictureCardFallbackInfo", id: 5 },
                        image_mint: { type: "BaseImage", id: 6 },
                        thumbnail_mint: { type: "BaseImage", id: 7 },
                        req_base: { type: "BaseReq", id: 200 },
                        resp_base: { type: "BaseResp", id: 201 }
                    }
                },
                PictureCardFallbackInfo: {
                    fields: {
                        image: { type: "BaseImage", id: 1 },
                        text: { type: "BaseText", id: 2 },
                        link_info: { type: "LinkInfo", id: 3 }
                    }
                },
                // PictureCard 依赖的基础类型
                BaseImage: {
                    fields: {}
                },
                PreviewHint: {
                    fields: {}
                },
                LinkInfo: {
                    fields: {}
                },
                BaseText: {
                    fields: {}
                },
                BaseReq: {
                    fields: {}
                },
                BaseResp: {
                    fields: {}
                }
            }
        }
    }
});

// 获取 Request 类型
const Request = root.lookupType("im_proto.Request");

/**
 * 从 protobufEncode.js 中提取的 t$ 函数
 * 原始代码: function t$(e) { return new Uint8Array(tF.encode(e).finish()) }
 * 其中 tF 是 Request 类型
 */
function t$(e) {
    return Request.encode(e).finish();
}

/**
 * 解码 protobuf 响应数据
 * 根据 protobufEncode.js 中的解码逻辑:
 * function tJ(e, t) {
 *     let n = new Uint8Array(t);
 *     try {
 *         return tH.decode(n)
 *     } catch (o) {
 *         // 错误处理
 *     }
 * }
 * 
 * decode(e) {
 *     let t = eg.performanceNow()
 *       , n = ee.Response.create(tJ(this.ctx, e));
 *     return this.resolve(C.Monitor).emitDuration(I.DecodeData, t),
 *     n
 * }
 * 
 * @param {Buffer|Uint8Array} buffer - 要解码的 protobuf 数据
 * @returns {Object} 解码后的 Response 对象
 */
function decodeResponse(buffer) {
    try {
        // 确保是 Uint8Array
        const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        
        // 获取 Response 类型
        const Response = root.lookupType("im_proto.Response");
        
        // 解码数据
        const decoded = Response.decode(data);
        
        // 转换为普通对象
        const object = Response.toObject(decoded, {
            longs: String,
            enums: String,
            bytes: String,
            defaults: true,
            arrays: true,
            objects: true,
            oneofs: true
        });
        
        return object;
    } catch (error) {
        console.error("解码响应失败:", error.message);
        throw error;
    }
}




// 导出函数



function encrpytCreateConversationV2(headers,uid,to_uid,sequence_id) { 
    //
    let seqId = sequence_id || Math.floor(Math.random() * 500) + 10000;
    const sequenceIdObj = Long.fromString(seqId.toString());
    let defaultHeaders = {
        "aid": "1988",
        "app_name": "tiktok_web",
        "channel": "web",
        "device_platform": "web_pc",
        "device_id": "7550358150861506062",
        "region": "JP",
        "priority_region": "JP",
        "os": "windows",
        "referer": "https://www.tiktok.com/",
        "root_referer": "https://www.tiktok.com/login/phone-or-email/email",
        "cookie_enabled": "true",
        "screen_width": "1920",
        "screen_height": "1080",
        "browser_language": "en-IE",
        "browser_platform": "Win32",
        "browser_name": "Mozilla",
        "browser_version": "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        "browser_online": "true",
        "verifyFp": "verify_mgi5e0a3_anOv7sQg_2pyl_40B0_89yq_mKXzocDdRDS5",
        "app_language": "en-GB",
        "webcast_language": "en-GB",
        "tz_name": "Asia/Shanghai",
        "is_page_visible": "true",
        "focus_state": "true",
        "is_fullscreen": "false",
        "history_len": "15",
        "user_is_login": "true",
        "data_collection_enabled": "true",
        "from_appID": "1988",
        "locale": "en-GB",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        "Web-Sdk-Ms-Token": "sdu4YexqZMAi83QqrRG00LYtOyBjXSIpOg34Qo2rKWxQaj360YHWXzeJVrTOGGXS_zZcIoj8KHrm6JYW8ECBNPkqpWAvmwfBUtWH2pgB-zfUfU54aqoQp36rj1rZXTU7rJ_osmlCrudymTQlv1TLR0Cy3l8="
    }
    defaultHeaders = Object.assign(defaultHeaders, headers);
    // defaultHeaders['user_agent'] = decodeURIComponent(defaultHeaders['user_agent']);
    let body = {
        "create_conversation_v2_body": {
            "conversation_type": 1,
            "participants": [
                Long.fromString(to_uid),
                Long.fromString(uid),
            ]
        }
    }
    let encodeBody = {
        "headers": defaultHeaders,
        "body": body,
        "cmd": 609,
        "sequence_id": sequenceIdObj,
        "refer": 3,
        "token": "",
        "device_id": defaultHeaders.device_id,
        "sdk_version": "1.3.0-beta.8",
        "build_number": "8575f05:feat/nice-fan-group2",
        "inbox_type": 0,
        "device_platform": "web",
        "auth_type": 1
    }
    return   t$(encodeBody)

}

//封装一个方法加密发送文本消息的protobuf
function encryptSendTextMessage(headers, text,chat_id,conversation_short_id,sequence_id) { 
    let client_message_id = uuidv4();
    
    // 定义 sequence_id
    if(!sequence_id){
        //10000 到 10500随机
        sequence_id = Math.floor(Math.random() * 500) + 10000;
    }
    const sequenceIdObj = Long.fromString(sequence_id.toString());
   
    let defaultHeaders = {
            "aid": "1988",
            "app_name": "tiktok_web",
            "channel": "web",
            "device_platform": "web_pc",
            "device_id": "7550358150861506062",
            "region": "JP",
            "priority_region": "JP",
            "os": "windows",
            "referer": "https://www.tiktok.com/",
            "root_referer": "",
            "cookie_enabled": "true",
            "screen_width": "1920",
            "screen_height": "1080",
            "browser_language": "en-IE",
            "browser_platform": "Win32",
            "browser_name": "Mozilla",
            "browser_version": "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            "browser_online": "true",
            "verifyFp": "verify_mgi5e0a3_anOv7sQg_2pyl_40B0_89yq_mKXzocDdRDS5",
            "app_language": "en-GB",
            "webcast_language": "en-GB",
            "tz_name": "Asia/Shanghai",
            "is_page_visible": "true",
            "focus_state": "true",
            "is_fullscreen": "false",
            "history_len": "2",
            "user_is_login": "true",
            "data_collection_enabled": "true",
            "from_appID": "1988",
            "locale": "en-GB",
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            "Web-Sdk-Ms-Token": "5A_5IIkFAudJWdVtB_AjZT17Ci8REU1AgpZzkW-UqjVsYi2jQVpuB8ORcP-mNV-j4bzkePga71uHRmhAS7MSdAomUbsUC8WptL7NEaiHDd4-ps2ONwuQbe7JIc6sDv5laZ9UHTCQjrFfWjKvfddClyTNFtc="
    }
    defaultHeaders = Object.assign(defaultHeaders, headers);
    // defaultHeaders['user_agent'] = decodeURIComponent(defaultHeaders['user_agent']);
    body = {
            "send_message_body": {
            "conversation_id": chat_id,
            "conversation_short_id": typeof conversation_short_id === 'object' ? new Long(conversation_short_id.low,conversation_short_id.high,conversation_short_id.unsigned) : Long.fromString(conversation_short_id),
                "conversation_type": 1,
            "content":  `{\"aweType\":0,\"text\":\"${text}\"}`,
                "mentioned_users": [],
            "client_message_id": client_message_id,
                "ticket": "deprecated",
                "message_type": 7,
                "ext": {
                    "s:mentioned_users": "",
                "s:client_message_id": client_message_id
                },
                "send_media_list": []
            }
    }
    let encodeBody = {
        headers:defaultHeaders,
        body:body,
        cmd:100,
        sequence_id:sequenceIdObj,
        refer:3,
        token:"",
        device_id:defaultHeaders.device_id,
        sdk_version:"1.3.0-beta.8",
        build_number:"8575f05:feat/nice-fan-group2",
        inbox_type:0,
        device_platform:"web",
        auth_type:1
    }
    return  t$(encodeBody)
}



// 调试工具：比较 testData 编码后的十六进制与 hexData 是否一致
function bytesToHex(u8) {
    return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function debugCompare() {
    try {
        const RequestType = root.lookupType("im_proto.Request");
        // 允许 fromObject 做必要的 Long/bytes 转换
        const message = RequestType.fromObject(testData);
        const encoded = RequestType.encode(message).finish();
        const actualHex = bytesToHex(encoded);

        const expectedHex = hexData.toLowerCase();
        const sameLen = actualHex.length === expectedHex.length;
        let firstDiff = -1;
        for (let i = 0; i < Math.min(actualHex.length, expectedHex.length); i++) {
            if (actualHex[i] !== expectedHex[i]) { firstDiff = i; break; }
        }

        console.log("=== Protobuf compare (Request.encode(testData)) ===");
        console.log("length(actual)", actualHex.length, "length(expected)", expectedHex.length, "sameLen:", sameLen);
        if (firstDiff === -1) {
            console.log("✅ 完全匹配");
        } else {
            const s = Math.max(0, firstDiff - 20);
            const e = Math.min(actualHex.length, firstDiff + 40);
            console.log("❌ 首个差异位置:", firstDiff);
            console.log("actual:", actualHex.slice(s, e));
            console.log("expect:", expectedHex.slice(s, e));
        }
        return { actualHex };
    } catch (err) {
        console.error("debugCompare error:", err && err.message ? err.message : err);
        throw err;
    }
}

module.exports = { 
    t$,
    encrpytCreateConversationV2,
    encryptSendTextMessage,
    decodeResponse,
    __debugCompare: debugCompare
};