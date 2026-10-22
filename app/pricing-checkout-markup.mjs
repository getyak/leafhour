// The same account dialog is used in-place before checkout.
export function pricingCheckoutMarkup(){return `<dialog autofocus id="auth-dialog" class="auth-dialog" aria-labelledby="auth-title" aria-describedby="auth-intro">
  <button class="dialog-close" id="billing-auth-close" data-close="auth-dialog" data-ui-aria-label="auth.close" aria-label="关闭登录">×</button>
  <div class="auth-brand" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 32V20A13 13 0 0 1 21 7h11v11a14 14 0 0 1-14 14H8Z"/><path d="M16 23h7v-9"/></svg><span lang="en">Leafhour</span></div>
  <h2 id="auth-title">回到你的书房</h2><p id="auth-intro">从上次停下的地方继续。</p>
  <div id="auth-email-step">
    <form id="email-form">
      <label for="email" data-ui="auth.email.label">邮箱</label><input id="email" type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@example.com" required maxlength="254">
      <div id="auth-password-field" class="auth-password-field"><label for="auth-password" data-ui="auth.password.label">密码</label><div class="auth-password-input"><input id="auth-password" name="password" type="password" autocomplete="current-password" required maxlength="1024" aria-describedby="auth-status"><button type="button" data-password-toggle="auth-password" aria-label="显示登录密码" aria-pressed="false">显示</button></div></div>
      <button class="primary" id="send-code" type="submit" disabled>进入书房</button>
    </form>
  </div>
  <div id="auth-code-step" hidden>
    <div class="auth-mailbox"><span id="auth-recipient"></span><button id="change-email" class="auth-text-button" data-ui="auth.email.change">更换邮箱</button></div>
    <form id="verify-form"><label for="email-code" data-ui="auth.code.label">登录验证码</label><input id="email-code" name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="12" aria-describedby="auth-status" required><button class="primary" id="verify-code" type="submit" disabled>进入书房</button></form>
    <div class="auth-code-meta"><span id="auth-expiry"></span><button id="resend-code" class="auth-text-button" disabled>重新发送</button></div>
  </div>
  <div id="auth-setup-step" hidden><form id="password-setup-form"><label for="new-password" data-ui="auth.password.newLabel">新密码</label><div class="auth-password-input"><input id="new-password" name="new-password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" aria-describedby="new-password-hint auth-status" required><button type="button" data-password-toggle="new-password" aria-label="显示新密码" aria-pressed="false">显示</button></div><p id="new-password-hint" data-ui="auth.password.hint">至少 8 个字符。</p><button class="primary" id="save-password" type="submit">保存并进入书房</button></form></div>
  <p id="auth-status" class="status" role="status" aria-live="polite"></p><p id="auth-availability" class="auth-availability">登录服务准备中，可以先试读。</p>
  <div id="auth-entry-actions" class="auth-entry-actions"><button id="use-code" class="auth-text-button" data-ui="auth.useCode">验证码登录</button><button id="use-password" class="auth-text-button" hidden data-ui="auth.usePassword">返回密码登录</button><button id="forgot-password" class="auth-text-button" data-ui="auth.forgot">忘记密码？</button></div>
  <div id="auth-alternatives"><div class="auth-divider"><span data-ui="auth.or">或</span></div><div class="auth-providers">
    <button id="login-google" data-ui-aria-label="auth.provider.google" class="auth-provider" disabled aria-label="使用 Google 登录"><img src="/auth-assets/google.png" alt="" width="18" height="18"><span>Google</span><span class="provider-state" data-ui="auth.provider.preparing">准备中</span></button>
    <button id="login-apple" data-ui-aria-label="auth.provider.apple" class="auth-provider" disabled aria-label="使用 Apple 登录"><img src="/auth-assets/apple.svg" alt="" width="18" height="18"><span>Apple</span><span class="provider-state" data-ui="auth.provider.preparing">准备中</span></button>
  </div></div>
  <div id="local-entry" hidden><div class="auth-divider"><span data-ui="auth.local.label">本机使用</span></div><button id="local-login" class="outline full" data-ui="auth.local.enter">进入本机书房 ↗</button><p class="local-note" data-ui="auth.local.note">仅在这台电脑使用，无需邮箱；与邮箱账户分开保存。</p></div>
  <div class="auth-footer"><p id="auth-signup" class="auth-signup"><span data-ui="auth.newHere">第一次来？</span><button id="create-account" class="auth-text-button" data-ui="auth.create">创建书房</button></p><a class="auth-skip" href="/read?book=gutenberg-alice"><span data-ui="auth.sample">先试读几页</span> <span aria-hidden="true">↗</span></a></div>
</dialog>`;}
