/**
 * Buffer2Cal - Google Apps Script
 * 
 * Overview: Automatically adds buffer time to Google Calendar events
 * 
 * Features:
 * - Enablement+ sessions (color code 4): Adds 60min before and 30min after buffer
 * - Appointments (Tomato color, code 11): Adds 30min before for short events, 60min before and 30min after for long events
 * - Datadog integration: Structured logging for buffer creation and trigger execution monitoring
 * 
 * Setup:
 * - Datadog API Key: Set DATADOG_API_KEY environment variable in project settings
 * - Calendar ID: Change kyouhei.ohno@datadoghq.com to target calendar ID
 * - Trigger: Set up "Calendar - Changed" trigger for onCalendarEventChanged function
 * 
 * Main Functions:
 * - onCalendarEventChanged(e): Main handler for calendar event changes
 * - addBufferEventsByColor(): Adds buffers for Enablement+ sessions
 * - addAppointmentBuffers(): Adds buffers for appointments
 * - sendToDatadog(): Sends logs to Datadog
 * 
 * Log Monitoring:
 * Available log types in Datadog:
 * - trigger_recorded: Trigger execution records
 * - event_matched: Target event detection
 * - buffer_added: Buffer creation
 * - trigger_error: Error occurrences
 * 
 * Notes:
 * - Deleted event details are not available (Google Apps Script limitation)
 * - Buffer events check for existing buffers to avoid duplicates
 * - Manual trigger management (auto-setup function removed)
 */

// Datadog logging configuration
// Set your Datadog API key using environment variables
var DATADOG_API_KEY = PropertiesService.getScriptProperties().getProperty('DATADOG_API_KEY') || 'YOUR_DATADOG_API_KEY';
var DATADOG_ENDPOINT = 'https://http-intake.logs.datadoghq.com/api/v2/logs';
var AWS_API_KEY = PropertiesService.getScriptProperties().getProperty('AWS_API_KEY') || 'YOUR_AWS_API_KEY';
var AWS_TRACE_ENDPOINT = 'https://16qbvsggqj.execute-api.ap-northeast-1.amazonaws.com/prod/traces';

function sendToDatadog(message, level = 'info', metadata = {}) {
  // APIキーが設定されていない場合はログのみ
  if (!DATADOG_API_KEY || DATADOG_API_KEY === 'YOUR_DATADOG_API_KEY') {
    Logger.log('DATADOG_API_KEY not set, skipping Datadog log: ' + message);
    return;
  }
  
  // 現在の時間と曜日を取得
  var now = new Date();
  var logHour = now.getHours();
  var logWeekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
  
  var logEntry = {
    timestamp: now.toISOString(),
    message: message,
    service: 'buffer2cal',
    ddsource: 'appscript',
    ddtags: 'env:kyo',
    status: level,
    log_hour: logHour,
    log_weekday: logWeekday,
    ...metadata
  };
  
  var options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': DATADOG_API_KEY
    },
    payload: JSON.stringify([logEntry]) // 配列形式で送信
  };
  
  try {
    var response = UrlFetchApp.fetch(DATADOG_ENDPOINT, options);
    Logger.log('Datadog response code: ' + response.getResponseCode());
    Logger.log('Datadog response: ' + response.getContentText());
  } catch (error) {
    Logger.log('Failed to send to Datadog: ' + error.toString());
    Logger.log('Error details: ' + JSON.stringify(error));
  }
}

function logToDatadog(message, level = 'info', metadata = {}) {
  // 既存のログ（プレーンテキスト）
  Logger.log(message);
  
  // Datadogには重要な処理のみ送信
  var importantKeywords = [
    'created', 'detected', 'successfully', 'trigger', 'error', 'failed', 'executed', 'changed', 'deleted', 'buffer'
  ];
  
  var shouldSendToDatadog = importantKeywords.some(function(keyword) {
    return message.toLowerCase().includes(keyword);
  });
  
  if (shouldSendToDatadog) {
    // 重要な属性を追加
    var enhancedMetadata = {
      ...metadata,
      timestamp: new Date().toISOString()
    };
    
    sendToDatadog(message, level, enhancedMetadata);
  }
}

// ===== TRACE FUNCTIONS =====

function generateTraceId() {
  // W3C Trace Context仕様に従って16バイト（128ビット）の16進数文字列を生成
  // 例: "4bf92f3577b34da6a3ce929d0e0e4736"
  var chars = '0123456789abcdef';
  var result = '';
  for (var i = 0; i < 32; i++) { // 32文字 = 16バイト
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateSpanId() {
  // W3C Trace Context仕様に従って8バイト（64ビット）の16進数文字列を生成
  // 例: "00f067aa0ba902b7"
  var chars = '0123456789abcdef';
  var result = '';
  for (var i = 0; i < 16; i++) { // 16文字 = 8バイト
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}


function createTraceSpan(spanName, parentSpanId, startTime, duration, metadata = {}) {
  var traceId = metadata.traceId || generateTraceId();
  var spanId = generateSpanId();
  
  // W3C Trace Contextの16進数文字列を10進数に変換
  // trace_id: 128ビットの下位64ビットを10進数で送信
  // span_id: 64ビットを10進数で送信
  return {
    "span_id": parseInt(spanId, 16),
    "trace_id": parseInt(traceId.substring(16), 16), // 下位64ビット（後半16文字）
    "parent_id": parentSpanId ? parseInt(parentSpanId, 16) : null,
    "name": spanName,
    "resource": "buffer2cal." + spanName.toLowerCase().replace(/\s+/g, '_'),
    "service": "buffer2cal",
    "type": "custom",
    "start": Math.floor(startTime * 1000000000), // ナノ秒（整数）
    "duration": Math.floor(duration * 1000000000), // ナノ秒（整数）
    "meta": {
      "env": "kyo",
      "language": "javascript",
      "platform": "google_apps_script",
      "function": spanName,
      "calendar_id": "kyouhei.ohno@datadoghq.com",
      "buffer_type": metadata.bufferType || "unknown",
      "event_color": metadata.eventColor || "unknown",
      "event_title": metadata.eventTitle || "unknown",
      "events_processed": String(metadata.eventsProcessed || 0),
      "buffers_created": String(metadata.buffersCreated || 0),
      "buffers_skipped": String(metadata.buffersSkipped || 0),
      "execution_result": metadata.executionResult || "success",
      "api_calls_made": String(metadata.apiCallsMade || 0),
      "error_message": metadata.errorMessage || ""
    }
  };
}

function sendTraceToAWS(traceData) {
  if (!AWS_API_KEY || AWS_API_KEY === 'YOUR_AWS_API_KEY') {
    Logger.log('AWS_API_KEY not set, skipping trace');
    return;
  }

  // Datadog Agent API形式に変換
  var agentTraceData = traceData.map(function(trace) {
    return trace.spans.map(function(span) {
      return {
        "span_id": span.span_id,
        "trace_id": span.trace_id,
        "parent_id": span.parent_id,
        "name": span.name,
        "resource": span.resource,
        "service": span.service,
        "type": span.type,
        "start": span.start,
        "duration": span.duration,
        "meta": span.meta,
        "metrics": span.metrics || {}
      };
    });
  });

  var options = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AWS_API_KEY
    },
    payload: JSON.stringify(agentTraceData)
  };

  try {
    Logger.log('Sending trace to AWS: ' + AWS_TRACE_ENDPOINT);
    var response = UrlFetchApp.fetch(AWS_TRACE_ENDPOINT, options);
    Logger.log('Trace sent successfully: ' + response.getResponseCode());
    Logger.log('AWS response: ' + response.getContentText());
  } catch (error) {
    Logger.log('Failed to send trace to AWS: ' + error.toString());
  }
}

function addBufferEventsByColor(traceId, parentStartTime) {
  var startTime = Date.now() / 1000;
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com'); // ここに自分のカレンダーIDを入力
  var targetColor = "4"; // ターゲットの色コードを文字列として指定

  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90))); // 今後90日間のイベントを取得

  var colorEvents = [];
  var temfeEvents = [];
  var buffersCreated = 0;
  var buffersSkipped = 0;

  events.forEach(function(event) {
    var eventColor = event.getColor();
    var eventTitle = event.getTitle();
    // 詳細ログはLogger.logのみ（Datadogには送信しない）
    Logger.log('Event: ' + eventTitle + ', Color: ' + eventColor);

    // TEM-FE イベントのチェック（タイトルが "Kyouhei Ohno [TEM-FE]" で終わる場合）
    if (eventTitle.endsWith('Kyouhei Ohno [TEM-FE]')) {
      temfeEvents.push(event);
      Logger.log('TEM-FE event detected: ' + eventTitle);
      addTEMFEBuffers(event);
    }
    // ターゲットの色かどうかを確認
    else if (eventColor === targetColor) {
      colorEvents.push(event);
      Logger.log('Target color matched for event: ' + event.getTitle());
      var startTime = event.getStartTime();
      var endTime = event.getEndTime();
      
      // 前のバッファ時間（60分前）
      var beforeBufferStart = new Date(startTime.getTime() - 60 * 60 * 1000);
      var beforeBufferEnd = startTime;
      
      // 後のバッファ時間（30分後）
      var afterBufferStart = endTime;
      var afterBufferEnd = new Date(endTime.getTime() + 30 * 60 * 1000);

      // 前のバッファイベントが既に存在しないか確認
      var existingBeforeEvents = calendar.getEvents(beforeBufferStart, beforeBufferEnd);
      var beforeBufferExists = false;
      var beforeBufferToReplace = null;
      
      existingBeforeEvents.forEach(function(existingEvent) {
        if ((existingEvent.getTitle() === 'E+ Buffer' && 
             existingEvent.getDescription().includes('Buffer time for Enablement+ session') &&
             existingEvent.getDescription().includes('added_by_script:true')) ||
            (existingEvent.getTitle() === 'Appointment Buffer' && 
             existingEvent.getDescription().includes('Buffer time for appointment') &&
             existingEvent.getDescription().includes('added_by_script:true'))) {
          
          // 既存バッファの長さを計算
          var existingDuration = (existingEvent.getEndTime().getTime() - existingEvent.getStartTime().getTime()) / (1000 * 60);
          var newDuration = 60; // E+ Bufferの前バッファは60分
          
          if (newDuration > existingDuration) {
            // 新しいバッファの方が長い場合は置き換え対象
            beforeBufferToReplace = existingEvent;
          } else {
            // 既存バッファの方が長いか同じ場合は作成しない
            beforeBufferExists = true;
          }
        }
      });

      // 後のバッファイベントが既に存在しないか確認
      var existingAfterEvents = calendar.getEvents(afterBufferStart, afterBufferEnd);
      var afterBufferExists = false;
      var afterBufferToReplace = null;
      
      existingAfterEvents.forEach(function(existingEvent) {
        if ((existingEvent.getTitle() === 'E+ Buffer' && 
             existingEvent.getDescription().includes('Buffer time for Enablement+ session') &&
             existingEvent.getDescription().includes('added_by_script:true')) ||
            (existingEvent.getTitle() === 'Appointment Buffer' && 
             existingEvent.getDescription().includes('Buffer time for appointment') &&
             existingEvent.getDescription().includes('added_by_script:true'))) {
          
          // 既存バッファの長さを計算
          var existingDuration = (existingEvent.getEndTime().getTime() - existingEvent.getStartTime().getTime()) / (1000 * 60);
          var newDuration = 30; // E+ Bufferの後バッファは30分
          
          if (newDuration > existingDuration) {
            // 新しいバッファの方が長い場合は置き換え対象
            afterBufferToReplace = existingEvent;
          } else {
            // 既存バッファの方が長いか同じ場合は作成しない
            afterBufferExists = true;
          }
        }
      });

      // 前のバッファイベントを作成または置き換え
      if (!beforeBufferExists) {
        // 既存バッファを置き換える場合
        if (beforeBufferToReplace) {
          try {
            beforeBufferToReplace.deleteEvent();
            Logger.log('Replaced existing buffer with longer E+ Buffer: ' + beforeBufferToReplace.getTitle());
            logToDatadog('🔄 Replaced existing buffer with longer E+ Buffer: ' + beforeBufferToReplace.getTitle(), 'warn', {
              function: 'addBufferEventsByColor',
              eventTitle: event.getTitle(),
              replacedBufferTitle: beforeBufferToReplace.getTitle(),
              replacedBufferType: beforeBufferToReplace.getTitle(),
              action: 'buffer_replaced',
              type: 'buffer_replacement',
              result: 'success'
            });
          } catch (error) {
            Logger.log('Error deleting existing buffer: ' + error.toString());
            logToDatadog('Error deleting existing buffer: ' + error.toString(), 'error', {
              function: 'addBufferEventsByColor',
              eventTitle: event.getTitle(),
              error: error.toString(),
              action: 'buffer_replacement_error',
              type: 'buffer_replacement'
            });
          }
        }
        
        var beforeBufferEvent = calendar.createEvent('E+ Buffer', beforeBufferStart, beforeBufferEnd, {
          description: 'Buffer time for Enablement+ session. Added by Apps Script.\n\nDatadog Logs: https://kyouhei.datadoghq.com/logs?query=service%3Abuffer2cal&live=true\n\nadded_by_script:true'
        });
        beforeBufferEvent.setColor(CalendarApp.EventColor.GRAY); // グレイに設定
        logToDatadog('✅ E+ Buffer created successfully: ' + event.getTitle(), 'warn', {
          function: 'addBufferEventsByColor',
          eventTitle: event.getTitle(),
          eventStartTime: startTime.toISOString(),
          eventEndTime: endTime.toISOString(),
          eventDurationMinutes: (endTime.getTime() - startTime.getTime()) / (1000 * 60),
          bufferType: 'E+ Buffer',
          bufferPosition: 'before',
          bufferStartTime: beforeBufferStart.toISOString(),
          bufferEndTime: beforeBufferEnd.toISOString(),
          bufferDurationMinutes: 60,
          targetColor: targetColor,
          action: 'buffer_created',
          type: 'buffer_added',
          result: 'success'
        });
        buffersCreated++;
      } else {
        Logger.log('Before buffer event already exists for: ' + event.getTitle());
        buffersSkipped++;
      }

      // 後のバッファイベントを作成または置き換え
      if (!afterBufferExists) {
        // 既存バッファを置き換える場合
        if (afterBufferToReplace) {
          try {
            afterBufferToReplace.deleteEvent();
            Logger.log('Replaced existing buffer with longer E+ Buffer: ' + afterBufferToReplace.getTitle());
            logToDatadog('🔄 Replaced existing buffer with longer E+ Buffer: ' + afterBufferToReplace.getTitle(), 'warn', {
              function: 'addBufferEventsByColor',
              eventTitle: event.getTitle(),
              replacedBufferTitle: afterBufferToReplace.getTitle(),
              replacedBufferType: afterBufferToReplace.getTitle(),
              action: 'buffer_replaced',
              type: 'buffer_replacement',
              result: 'success'
            });
          } catch (error) {
            Logger.log('Error deleting existing buffer: ' + error.toString());
            logToDatadog('Error deleting existing buffer: ' + error.toString(), 'error', {
              function: 'addBufferEventsByColor',
              eventTitle: event.getTitle(),
              error: error.toString(),
              action: 'buffer_replacement_error',
              type: 'buffer_replacement'
            });
          }
        }
        
        var afterBufferEvent = calendar.createEvent('E+ Buffer', afterBufferStart, afterBufferEnd, {
          description: 'Buffer time for Enablement+ session. Added by Apps Script.\n\nDatadog Logs: https://kyouhei.datadoghq.com/logs?query=service%3Abuffer2cal&live=true\n\nadded_by_script:true'
        });
        afterBufferEvent.setColor(CalendarApp.EventColor.GRAY); // グレイに設定
        logToDatadog('✅ E+ Buffer created successfully: ' + event.getTitle(), 'warn', {
          function: 'addBufferEventsByColor',
          eventTitle: event.getTitle(),
          eventStartTime: startTime.toISOString(),
          eventEndTime: endTime.toISOString(),
          eventDurationMinutes: (endTime.getTime() - startTime.getTime()) / (1000 * 60),
          bufferType: 'E+ Buffer',
          bufferPosition: 'after',
          bufferStartTime: afterBufferStart.toISOString(),
          bufferEndTime: afterBufferEnd.toISOString(),
          bufferDurationMinutes: 30,
          targetColor: targetColor,
          action: 'buffer_created',
          type: 'buffer_added',
          result: 'success'
        });
        buffersCreated++;
      } else {
        Logger.log('After buffer event already exists for: ' + event.getTitle());
        buffersSkipped++;
      }
    }
  });

  var duration = (Date.now() / 1000) - startTime;
  var result = {
    eventsProcessed: colorEvents.length + temfeEvents.length,
    buffersCreated: buffersCreated,
    buffersSkipped: buffersSkipped,
    colorEventsProcessed: colorEvents.length,
    temfeEventsProcessed: temfeEvents.length
  };

           // スパンを作成（送信はしない）
           var span = createTraceSpan('addBufferEventsByColor', null, startTime, duration, {
             traceId: traceId,
             bufferType: 'E+ Buffer',
             eventColor: targetColor,
             eventsProcessed: colorEvents.length + temfeEvents.length,
             buffersCreated: buffersCreated,
             buffersSkipped: buffersSkipped,
             executionResult: 'success',
             apiCallsMade: colorEvents.length * 2 // getEvents calls for before/after
           });

  result.span = span;
  return result;
}

function addAppointmentBuffers(traceId, parentStartTime) {
  var startTime = Date.now() / 1000;
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com'); // ここに自分のカレンダーIDを入力
  var tomatoColor = "11"; // Tomato色の色コード
  
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90))); // 今後90日間のイベントを取得

  var tomatoEvents = [];
  var buffersCreated = 0;
  var buffersSkipped = 0;

  events.forEach(function(event) {
    var eventColor = event.getColor();
    // 詳細ログはLogger.logのみ（Datadogには送信しない）
    Logger.log('Checking event: ' + event.getTitle() + ', Color: ' + eventColor);

    // Tomato色のイベントかどうかを確認
    if (eventColor === tomatoColor) {
      tomatoEvents.push(event);
      Logger.log('Tomato color matched for event: ' + event.getTitle());
      var startTime = event.getStartTime();
      var endTime = event.getEndTime();
      
      // イベントの長さを計算（分単位）
      var eventDurationMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      
      // 前のバッファ時間を決定（30分以下のイベントは30分前、それ以外は60分前）
      var beforeBufferMinutes = eventDurationMinutes <= 30 ? 30 : 60;
      var beforeBufferStart = new Date(startTime.getTime() - beforeBufferMinutes * 60 * 1000);
      var beforeBufferEnd = startTime;
      
      // 後のバッファ時間（30分後）
      var afterBufferStart = endTime;
      var afterBufferEnd = new Date(endTime.getTime() + 30 * 60 * 1000);

      // 詳細ログはLogger.logのみ
      Logger.log('Event duration: ' + eventDurationMinutes + ' minutes, before buffer: ' + beforeBufferMinutes + ' minutes');

      // 前のバッファイベントが既に存在しないか確認
      var existingBeforeEvents = calendar.getEvents(beforeBufferStart, beforeBufferEnd);
      var beforeBufferExists = existingBeforeEvents.some(function(existingEvent) {
        return existingEvent.getTitle() === 'Appointment Buffer' && 
               existingEvent.getDescription().includes('Buffer time for appointment') &&
               existingEvent.getDescription().includes('added_by_script:true');
      });

      // 後のバッファイベントが既に存在しないか確認
      var existingAfterEvents = calendar.getEvents(afterBufferStart, afterBufferEnd);
      var afterBufferExists = existingAfterEvents.some(function(existingEvent) {
        return existingEvent.getTitle() === 'Appointment Buffer' && 
               existingEvent.getDescription().includes('Buffer time for appointment') &&
               existingEvent.getDescription().includes('added_by_script:true');
      });

      // 前のバッファイベントを作成
      if (!beforeBufferExists) {
        var beforeBufferEvent = calendar.createEvent('Appointment Buffer', beforeBufferStart, beforeBufferEnd, {
          description: 'Buffer time for appointment. Added by Apps Script.\n\nDatadog Logs: https://kyouhei.datadoghq.com/logs?query=service%3Abuffer2cal&live=true\n\nadded_by_script:true'
        });
        beforeBufferEvent.setColor(CalendarApp.EventColor.GRAY); // グレイに設定
        logToDatadog('✅ Appointment Buffer created successfully: ' + event.getTitle(), 'warn', {
          function: 'addAppointmentBuffers',
          eventTitle: event.getTitle(),
          eventStartTime: startTime.toISOString(),
          eventEndTime: endTime.toISOString(),
          eventDurationMinutes: eventDurationMinutes,
          bufferType: 'Appointment Buffer',
          bufferPosition: 'before',
          bufferStartTime: beforeBufferStart.toISOString(),
          bufferEndTime: beforeBufferEnd.toISOString(),
          bufferDurationMinutes: beforeBufferMinutes,
          targetColor: tomatoColor,
          action: 'buffer_created',
          bufferAdjustment: eventDurationMinutes <= 30 ? 'short_event_30min' : 'long_event_60min',
          type: 'buffer_added',
          result: 'success'
        });
        buffersCreated++;
      } else {
        Logger.log('Before buffer event already exists for: ' + event.getTitle());
        buffersSkipped++;
      }

      // 後のバッファイベントを作成
      if (!afterBufferExists) {
        var afterBufferEvent = calendar.createEvent('Appointment Buffer', afterBufferStart, afterBufferEnd, {
          description: 'Buffer time for appointment. Added by Apps Script.\n\nDatadog Logs: https://kyouhei.datadoghq.com/logs?query=service%3Abuffer2cal&live=true\n\nadded_by_script:true'
        });
        afterBufferEvent.setColor(CalendarApp.EventColor.GRAY); // グレイに設定
        logToDatadog('✅ Appointment Buffer created successfully: ' + event.getTitle(), 'warn', {
          function: 'addAppointmentBuffers',
          eventTitle: event.getTitle(),
          eventStartTime: startTime.toISOString(),
          eventEndTime: endTime.toISOString(),
          eventDurationMinutes: eventDurationMinutes,
          bufferType: 'Appointment Buffer',
          bufferPosition: 'after',
          bufferStartTime: afterBufferStart.toISOString(),
          bufferEndTime: afterBufferEnd.toISOString(),
          bufferDurationMinutes: 30,
          targetColor: tomatoColor,
          action: 'buffer_created',
          type: 'buffer_added',
          result: 'success'
        });
        buffersCreated++;
      } else {
        Logger.log('After buffer event already exists for: ' + event.getTitle());
        buffersSkipped++;
      }
    }
  });

  var duration = (Date.now() / 1000) - startTime;
  var result = {
    eventsProcessed: tomatoEvents.length,
    buffersCreated: buffersCreated,
    buffersSkipped: buffersSkipped
  };

           // スパンを作成（送信はしない）
           var span = createTraceSpan('addAppointmentBuffers', null, startTime, duration, {
             traceId: traceId,
             bufferType: 'Appointment Buffer',
             eventColor: tomatoColor,
             eventsProcessed: tomatoEvents.length,
             buffersCreated: buffersCreated,
             buffersSkipped: buffersSkipped,
             executionResult: 'success',
             apiCallsMade: tomatoEvents.length * 2 // getEvents calls for before/after
           });

  result.span = span;
  return result;
}

function onCalendarEventChanged(e) {
  var traceId = generateTraceId();
  var startTime = Date.now() / 1000; // Unix timestamp in seconds
  
  try {
    logToDatadog('📅 Calendar event changed, running buffer check', 'info', {
      function: 'onCalendarEventChanged',
      triggerType: 'calendar_event_changed',
      action: 'trigger_started',
      type: 'trigger_recorded',
      result: 'detected'
    });

    // カレンダーが更新されたら、どんなイベントでもバッファチェックを実行
    var temfeResult = addBuffersForTEMFEEventsWithoutBuffers(traceId, startTime);
    var appointmentResult = addAppointmentBuffers(traceId, startTime);
    var colorResult = addBufferEventsByColor(traceId, startTime);
    
    // 実行完了のサマリーログ
    var totalBuffersCreated = (temfeResult.buffersCreated || 0) + (appointmentResult.buffersCreated || 0) + (colorResult.buffersCreated || 0);
    var totalEventsProcessed = (temfeResult.eventsProcessed || 0) + (appointmentResult.eventsProcessed || 0) + (colorResult.eventsProcessed || 0);
    
    logToDatadog('✅ Buffer check completed successfully', 'info', {
      function: 'onCalendarEventChanged',
      triggerType: 'calendar_event_changed',
      action: 'trigger_completed',
      type: 'trigger_recorded',
      result: 'success',
      totalEventsProcessed: totalEventsProcessed,
      totalBuffersCreated: totalBuffersCreated,
      temfeBuffersCreated: temfeResult.buffersCreated || 0,
      appointmentBuffersCreated: appointmentResult.buffersCreated || 0,
      colorBuffersCreated: colorResult.buffersCreated || 0
    });
    
             // メインスパンを作成
             var duration = (Date.now() / 1000) - startTime;
             var mainSpan = createTraceSpan('onCalendarEventChanged', null, startTime, duration, {
               traceId: traceId,
               eventsProcessed: totalEventsProcessed,
               buffersCreated: totalBuffersCreated,
               executionResult: 'success',
               apiCallsMade: 3 // 3つの関数を呼び出し
             });
    
    // サブスパンに親スパンIDを設定
    var allSpans = [mainSpan];
    if (temfeResult.span) {
      temfeResult.span.parent_id = mainSpan.span_id;
      allSpans.push(temfeResult.span);
    }
    if (appointmentResult.span) {
      appointmentResult.span.parent_id = mainSpan.span_id;
      allSpans.push(appointmentResult.span);
    }
    if (colorResult.span) {
      colorResult.span.parent_id = mainSpan.span_id;
      allSpans.push(colorResult.span);
    }
    
    var traceData = [{
      spans: allSpans
    }];
    
    sendTraceToAWS(traceData);
    
  } catch (error) {
    Logger.log('ERROR in onCalendarEventChanged: ' + error.toString());
    logToDatadog('Error in calendar trigger: ' + error.toString(), 'error', {
      function: 'onCalendarEventChanged',
      action: 'trigger_error',
      error: error.toString(),
      type: 'trigger_recorded'
    });
    
    // エラートレース送信
    var duration = (Date.now() / 1000) - startTime;
    var errorSpan = createTraceSpan('onCalendarEventChanged', null, startTime, duration, {
      traceId: traceId,
      executionResult: 'error',
      errorMessage: error.toString()
    });
    
    var errorTraceData = [{
      spans: [errorSpan]
    }];
    
    sendTraceToAWS(errorTraceData);
  }
}

function listEventColors() {
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com'); // ここに自分のカレンダーIDを入力
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90))); // 今後90日間のイベントを取得

  events.forEach(function(event) {
    var eventColor = event.getColor();
    var eventTitle = event.getTitle();
    logToDatadog('Event: ' + eventTitle + ', Color: ' + eventColor, 'info', {
      function: 'listEventColors',
      eventTitle: eventTitle,
      eventColor: eventColor,
      type: 'event_inspection'
    });
  });
}

function testAppointmentBuffers() {
  // テスト用の関数 - 手動で実行して動作確認
  logToDatadog('Testing addAppointmentBuffers function...', 'info', {
    function: 'testAppointmentBuffers',
    action: 'start_test',
    type: 'testing'
  });
  addAppointmentBuffers();
  logToDatadog('Test completed', 'info', {
    function: 'testAppointmentBuffers',
    action: 'test_completed',
    type: 'testing'
  });
}

function addTEMFEBuffers(event) {
  // TEM-FE イベント用の15分バッファを追加する関数
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var startTime = event.getStartTime();
  var endTime = event.getEndTime();
  var eventTitle = event.getTitle();
  
  // 前のバッファ時間（15分前）
  var beforeBufferStart = new Date(startTime.getTime() - 15 * 60 * 1000);
  var beforeBufferEnd = startTime;
  
  // 後のバッファ時間（15分後）
  var afterBufferStart = endTime;
  var afterBufferEnd = new Date(endTime.getTime() + 15 * 60 * 1000);

  Logger.log('Adding TEM-FE buffers for: ' + eventTitle);
  Logger.log('Before buffer: ' + beforeBufferStart + ' to ' + beforeBufferEnd);
  Logger.log('After buffer: ' + afterBufferStart + ' to ' + afterBufferEnd);

  // 前のバッファイベントが既に存在しないか確認
  var existingBeforeEvents = calendar.getEvents(beforeBufferStart, beforeBufferEnd);
  var beforeBufferExists = existingBeforeEvents.some(function(existingEvent) {
    return existingEvent.getTitle() === 'FE Buffer' && 
           existingEvent.getDescription().includes('Buffer time for FE event') &&
           existingEvent.getDescription().includes('added_by_script:true');
  });

  // 後のバッファイベントが既に存在しないか確認
  var existingAfterEvents = calendar.getEvents(afterBufferStart, afterBufferEnd);
  var afterBufferExists = existingAfterEvents.some(function(existingEvent) {
    return existingEvent.getTitle() === 'FE Buffer' && 
           existingEvent.getDescription().includes('Buffer time for FE event') &&
           existingEvent.getDescription().includes('added_by_script:true');
  });

  // 前のバッファイベントを作成
  if (!beforeBufferExists) {
    try {
      var beforeBufferEvent = calendar.createEvent('FE Buffer', beforeBufferStart, beforeBufferEnd, {
        description: 'Buffer time for FE event. Added by Apps Script.\n\nDatadog Logs: https://kyouhei.datadoghq.com/logs?query=service%3Abuffer2cal&live=true\n\nadded_by_script:true'
      });
      beforeBufferEvent.setColor(CalendarApp.EventColor.GRAY);
      logToDatadog('✅ FE Buffer created successfully: ' + eventTitle, 'warn', {
        function: 'addTEMFEBuffers',
        eventTitle: eventTitle,
        eventStartTime: startTime.toISOString(),
        eventEndTime: endTime.toISOString(),
        eventDurationMinutes: (endTime.getTime() - startTime.getTime()) / (1000 * 60),
        bufferType: 'FE Buffer',
        bufferPosition: 'before',
        bufferStartTime: beforeBufferStart.toISOString(),
        bufferEndTime: beforeBufferEnd.toISOString(),
        bufferDurationMinutes: 15,
        action: 'buffer_created',
        type: 'buffer_added',
        result: 'success'
      });
    } catch (error) {
      Logger.log('Error creating before FE Buffer: ' + error.toString());
      logToDatadog('Error creating before FE Buffer: ' + error.toString(), 'error', {
        function: 'addTEMFEBuffers',
        eventTitle: eventTitle,
        error: error.toString(),
        type: 'buffer_creation_error'
      });
    }
  } else {
    Logger.log('Before FE buffer event already exists for: ' + eventTitle);
  }

  // 後のバッファイベントを作成
  if (!afterBufferExists) {
    try {
      var afterBufferEvent = calendar.createEvent('FE Buffer', afterBufferStart, afterBufferEnd, {
        description: 'Buffer time for FE event. Added by Apps Script.\n\nDatadog Logs: https://kyouhei.datadoghq.com/logs?query=service%3Abuffer2cal&live=true\n\nadded_by_script:true'
      });
      afterBufferEvent.setColor(CalendarApp.EventColor.GRAY);
      logToDatadog('✅ FE Buffer created successfully: ' + eventTitle, 'warn', {
        function: 'addTEMFEBuffers',
        eventTitle: eventTitle,
        eventStartTime: startTime.toISOString(),
        eventEndTime: endTime.toISOString(),
        eventDurationMinutes: (endTime.getTime() - startTime.getTime()) / (1000 * 60),
        bufferType: 'FE Buffer',
        bufferPosition: 'after',
        bufferStartTime: afterBufferStart.toISOString(),
        bufferEndTime: afterBufferEnd.toISOString(),
        bufferDurationMinutes: 15,
        action: 'buffer_created',
        type: 'buffer_added',
        result: 'success'
      });
    } catch (error) {
      Logger.log('Error creating after FE Buffer: ' + error.toString());
      logToDatadog('Error creating after FE Buffer: ' + error.toString(), 'error', {
        function: 'addTEMFEBuffers',
        eventTitle: eventTitle,
        error: error.toString(),
        type: 'buffer_creation_error'
      });
    }
  } else {
    Logger.log('After FE buffer event already exists for: ' + eventTitle);
  }
}

function checkTomatoEvents() {
  // Tomato色のイベントのみを確認する関数
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var tomatoColor = "11"; // Tomato色の色コード
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90)));
  
  var tomatoEvents = [];
  events.forEach(function(event) {
    var eventColor = event.getColor();
    if (eventColor === tomatoColor) {
      tomatoEvents.push({
        title: event.getTitle(),
        start: event.getStartTime(),
        end: event.getEndTime(),
        color: eventColor
      });
    }
  });
  
  logToDatadog('Found ' + tomatoEvents.length + ' tomato colored events:', 'info', {
    function: 'checkTomatoEvents',
    tomatoEventsCount: tomatoEvents.length,
    targetColor: tomatoColor,
    type: 'event_inspection'
  });
  
  tomatoEvents.forEach(function(event) {
    logToDatadog('- ' + event.title + ' (' + event.start + ' to ' + event.end + ')', 'info', {
      function: 'checkTomatoEvents',
      eventTitle: event.title,
      eventStart: event.start.toISOString(),
      eventEnd: event.end.toISOString(),
      eventColor: event.color,
      type: 'event_inspection'
    });
  });
  
  return tomatoEvents;
}

function checkTEMFEEvents() {
  // TEM-FE イベントのみを確認する関数
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90)));
  
  var temfeEvents = [];
  events.forEach(function(event) {
    var eventTitle = event.getTitle();
    if (eventTitle.endsWith('Kyouhei Ohno [TEM-FE]')) {
      temfeEvents.push({
        title: eventTitle,
        start: event.getStartTime(),
        end: event.getEndTime(),
        color: event.getColor()
      });
    }
  });
  
  logToDatadog('Found ' + temfeEvents.length + ' TEM-FE events:', 'info', {
    function: 'checkTEMFEEvents',
    temfeEventsCount: temfeEvents.length,
    type: 'event_inspection'
  });
  
  temfeEvents.forEach(function(event) {
    logToDatadog('- ' + event.title + ' (' + event.start + ' to ' + event.end + ')', 'info', {
      function: 'checkTEMFEEvents',
      eventTitle: event.title,
      eventStart: event.start.toISOString(),
      eventEnd: event.end.toISOString(),
      eventColor: event.color,
      type: 'event_inspection'
    });
  });
  
  return temfeEvents;
}

function addTEMFEBuffersForAllEvents() {
  // 既存のTEM-FE イベントにバッファを手動で追加する関数
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90)));
  
  var temfeEvents = [];
  events.forEach(function(event) {
    var eventTitle = event.getTitle();
    if (eventTitle.endsWith('Kyouhei Ohno [TEM-FE]')) {
      temfeEvents.push(event);
    }
  });
  
  logToDatadog('Adding TEM-FE buffers for ' + temfeEvents.length + ' events', 'info', {
    function: 'addTEMFEBuffersForAllEvents',
    temfeEventsCount: temfeEvents.length,
    type: 'manual_execution'
  });
  
  temfeEvents.forEach(function(event) {
    logToDatadog('Processing TEM-FE event: ' + event.getTitle(), 'info', {
      function: 'addTEMFEBuffersForAllEvents',
      eventTitle: event.getTitle(),
      type: 'manual_execution'
    });
    addTEMFEBuffers(event);
  });
  
  return temfeEvents.length;
}

function checkForNewTEMFEEvents() {
  // 過去1時間以内に作成されたTEM-FEイベントをチェックしてバッファを追加
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  var now = new Date();
  var events = calendar.getEvents(oneHourAgo, now);
  
  var newTEMFEEvents = [];
  events.forEach(function(event) {
    var eventTitle = event.getTitle();
    if (eventTitle.endsWith('Kyouhei Ohno [TEM-FE]')) {
      newTEMFEEvents.push(event);
    }
  });
  
  logToDatadog('Checking for new TEM-FE events in the last hour: found ' + newTEMFEEvents.length, 'info', {
    function: 'checkForNewTEMFEEvents',
    newTEMFEEventsCount: newTEMFEEvents.length,
    type: 'scheduled_check'
  });
  
  newTEMFEEvents.forEach(function(event) {
    logToDatadog('Processing new TEM-FE event: ' + event.getTitle(), 'info', {
      function: 'checkForNewTEMFEEvents',
      eventTitle: event.getTitle(),
      type: 'scheduled_check'
    });
    addTEMFEBuffers(event);
  });
  
  return newTEMFEEvents.length;
}

function addBuffersForTEMFEEventsWithoutBuffers(traceId, parentStartTime) {
  var startTime = Date.now() / 1000;
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90)));
  
  var temfeEvents = [];
  events.forEach(function(event) {
    var eventTitle = event.getTitle();
    if (eventTitle.endsWith('Kyouhei Ohno [TEM-FE]')) {
      temfeEvents.push(event);
    }
  });
  
  logToDatadog('Checking ' + temfeEvents.length + ' TEM-FE events for missing buffers', 'info', {
    function: 'addBuffersForTEMFEEventsWithoutBuffers',
    temfeEventsCount: temfeEvents.length,
    type: 'buffer_check'
  });
  
  var processedCount = 0;
  var buffersCreated = 0;
  var buffersSkipped = 0;
  
  temfeEvents.forEach(function(event) {
    var startTime = event.getStartTime();
    var endTime = event.getEndTime();
    
    // 前のバッファ時間（15分前）
    var beforeBufferStart = new Date(startTime.getTime() - 15 * 60 * 1000);
    var beforeBufferEnd = startTime;
    
    // 後のバッファ時間（15分後）
    var afterBufferStart = endTime;
    var afterBufferEnd = new Date(endTime.getTime() + 15 * 60 * 1000);

    // 前のバッファイベントが既に存在しないか確認
    var existingBeforeEvents = calendar.getEvents(beforeBufferStart, beforeBufferEnd);
    var beforeBufferExists = existingBeforeEvents.some(function(existingEvent) {
      return existingEvent.getTitle() === 'FE Buffer' && 
             existingEvent.getDescription().includes('Buffer time for FE event') &&
             existingEvent.getDescription().includes('added_by_script:true');
    });

    // 後のバッファイベントが既に存在しないか確認
    var existingAfterEvents = calendar.getEvents(afterBufferStart, afterBufferEnd);
    var afterBufferExists = existingAfterEvents.some(function(existingEvent) {
      return existingEvent.getTitle() === 'FE Buffer' && 
             existingEvent.getDescription().includes('Buffer time for FE event') &&
             existingEvent.getDescription().includes('added_by_script:true');
    });

    // バッファが存在しない場合のみ追加
    if (!beforeBufferExists || !afterBufferExists) {
      logToDatadog('Adding missing buffers for: ' + event.getTitle(), 'info', {
        function: 'addBuffersForTEMFEEventsWithoutBuffers',
        eventTitle: event.getTitle(),
        beforeBufferExists: beforeBufferExists,
        afterBufferExists: afterBufferExists,
        type: 'buffer_check'
      });
      addTEMFEBuffers(event);
      processedCount++;
      buffersCreated += (!beforeBufferExists ? 1 : 0) + (!afterBufferExists ? 1 : 0);
    } else {
      Logger.log('Buffers already exist for: ' + event.getTitle());
      buffersSkipped += 2; // Both before and after buffers exist
    }
  });
  
  logToDatadog('Processed ' + processedCount + ' TEM-FE events with missing buffers', 'info', {
    function: 'addBuffersForTEMFEEventsWithoutBuffers',
    processedCount: processedCount,
    type: 'buffer_check_completed'
  });
  
  var duration = (Date.now() / 1000) - startTime;
  var result = {
    eventsProcessed: temfeEvents.length,
    buffersCreated: buffersCreated,
    buffersSkipped: buffersSkipped,
    processedCount: processedCount
  };
  
           // スパンを作成（送信はしない）
           var span = createTraceSpan('addBuffersForTEMFEEventsWithoutBuffers', null, startTime, duration, {
             traceId: traceId,
             bufferType: 'FE Buffer',
             eventsProcessed: temfeEvents.length,
             buffersCreated: buffersCreated,
             buffersSkipped: buffersSkipped,
             executionResult: 'success',
             apiCallsMade: temfeEvents.length * 2 // getEvents calls for before/after
           });
  
  result.span = span;
  return result;
}

function cleanupDuplicateFEBuffers() {
  // 重複したFE Bufferイベントを削除する緊急関数
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90)));
  
  var feBuffers = [];
  events.forEach(function(event) {
    if (event.getTitle() === 'FE Buffer') {
      feBuffers.push(event);
    }
  });
  
  logToDatadog('Found ' + feBuffers.length + ' FE Buffer events to clean up', 'warn', {
    function: 'cleanupDuplicateFEBuffers',
    feBufferCount: feBuffers.length,
    type: 'cleanup'
  });
  
  var deletedCount = 0;
  feBuffers.forEach(function(event) {
    try {
      event.deleteEvent();
      deletedCount++;
      Logger.log('Deleted FE Buffer: ' + event.getStartTime() + ' to ' + event.getEndTime());
    } catch (error) {
      Logger.log('Error deleting FE Buffer: ' + error.toString());
    }
  });
  
  logToDatadog('Cleanup completed: deleted ' + deletedCount + ' FE Buffer events', 'warn', {
    function: 'cleanupDuplicateFEBuffers',
    deletedCount: deletedCount,
    type: 'cleanup_completed'
  });
  
  return deletedCount;
}

function cleanupDuplicateFEBuffersSlowly() {
  // 段階的にFE Bufferイベントを削除する関数（レート制限対応）
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90)));
  
  var feBuffers = [];
  events.forEach(function(event) {
    if (event.getTitle() === 'FE Buffer') {
      feBuffers.push(event);
    }
  });
  
  logToDatadog('Found ' + feBuffers.length + ' FE Buffer events to clean up slowly', 'warn', {
    function: 'cleanupDuplicateFEBuffersSlowly',
    feBufferCount: feBuffers.length,
    type: 'cleanup_slow'
  });
  
  var deletedCount = 0;
  var maxDeletions = 50; // 一度に最大50個まで削除
  
  for (var i = 0; i < Math.min(feBuffers.length, maxDeletions); i++) {
    try {
      feBuffers[i].deleteEvent();
      deletedCount++;
      Logger.log('Deleted FE Buffer ' + (i + 1) + '/' + Math.min(feBuffers.length, maxDeletions) + ': ' + feBuffers[i].getStartTime() + ' to ' + feBuffers[i].getEndTime());
      
      // 削除間隔を空ける（100ms待機）
      Utilities.sleep(100);
    } catch (error) {
      Logger.log('Error deleting FE Buffer: ' + error.toString());
      // エラーが発生したら処理を停止
      break;
    }
  }
  
  logToDatadog('Slow cleanup completed: deleted ' + deletedCount + ' FE Buffer events', 'warn', {
    function: 'cleanupDuplicateFEBuffersSlowly',
    deletedCount: deletedCount,
    remainingCount: feBuffers.length - deletedCount,
    type: 'cleanup_slow_completed'
  });
  
  return deletedCount;
}

function cleanupDuplicateFEBuffersAuto() {
  // 自動で継続的にバッファイベントを削除する関数
  var calendar = CalendarApp.getCalendarById('kyouhei.ohno@datadoghq.com');
  var events = calendar.getEvents(new Date(), new Date(new Date().setDate(new Date().getDate() + 90)));
  
  // 検索対象のバッファタイプを設定（変更可能）
  var targetBufferType = 'E+ Buffer'; // 'FE Buffer' や 'Appointment Buffer' に変更可能
  
  var feBuffers = [];
  events.forEach(function(event) {
    if (event.getTitle() === targetBufferType) {
      feBuffers.push(event);
    }
  });
  
  if (feBuffers.length === 0) {
    logToDatadog('All ' + targetBufferType + ' events have been cleaned up!', 'info', {
      function: 'cleanupDuplicateFEBuffersAuto',
      targetBufferType: targetBufferType,
      type: 'cleanup_complete'
    });
    return 0;
  }
  
  logToDatadog('Auto cleanup: Found ' + feBuffers.length + ' ' + targetBufferType + ' events remaining', 'warn', {
    function: 'cleanupDuplicateFEBuffersAuto',
    feBufferCount: feBuffers.length,
    targetBufferType: targetBufferType,
    type: 'cleanup_auto'
  });
  
  var deletedCount = 0;
  var maxDeletions = 100; // 一度に最大100個まで削除
  
  for (var i = 0; i < Math.min(feBuffers.length, maxDeletions); i++) {
    try {
      feBuffers[i].deleteEvent();
      deletedCount++;
      Logger.log('Auto deleted ' + targetBufferType + ' ' + (i + 1) + '/' + Math.min(feBuffers.length, maxDeletions) + ': ' + feBuffers[i].getStartTime() + ' to ' + feBuffers[i].getEndTime());
      
      // 削除間隔を空ける（50ms待機）
      Utilities.sleep(50);
    } catch (error) {
      Logger.log('Error auto deleting ' + targetBufferType + ': ' + error.toString());
      // エラーが発生したら処理を停止
      break;
    }
  }
  
  logToDatadog('Auto cleanup batch completed: deleted ' + deletedCount + ' ' + targetBufferType + ' events', 'warn', {
    function: 'cleanupDuplicateFEBuffersAuto',
    deletedCount: deletedCount,
    remainingCount: feBuffers.length - deletedCount,
    targetBufferType: targetBufferType,
    type: 'cleanup_auto_completed'
  });
  
  // まだイベントが残っている場合は、1分後に再実行するトリガーを設定
  if (feBuffers.length - deletedCount > 0) {
    logToDatadog('Scheduling next cleanup in 1 minute. Remaining: ' + (feBuffers.length - deletedCount), 'warn', {
      function: 'cleanupDuplicateFEBuffersAuto',
      remainingCount: feBuffers.length - deletedCount,
      type: 'cleanup_scheduled'
    });
    
    // 1分後に再実行するトリガーを設定
    ScriptApp.newTrigger('cleanupDuplicateFEBuffersAuto')
      .timeBased()
      .after(1 * 60 * 1000) // 1分後
      .create();
  }
  
  return deletedCount;
}