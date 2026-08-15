/**
 * Notification Templates for Pinterest-like Platform
 */

export type NotificationType = 'POST_SUCCESS' | 'POST_AI_SUCCESS' | 'LIKE' | 'COMMENT' | 'SAVE' | 'SHARE' | 'MILESTONE_10_LIKES' | 'MILESTONE_50_LIKES';
export type NotificationTone = 'friendly' | 'formal' | 'concise';

export interface NotificationTemplate {
  event: NotificationType;
  tone: NotificationTone;
  title: string;
  message: string;
  action_text: string;
  variables: string[];
  icon: string;
  color: string;
}

export interface NotificationData {
  post_title?: string;
  post_url?: string;
  actor_name?: string;
  interaction_type?: string;
  time_ago?: string;
  username?: string;
  [key: string]: string | undefined;
}

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  {
    event: 'POST_SUCCESS',
    tone: 'friendly',
    title: '🎉 Bài viết của bạn đã được đăng!',
    message: 'Tuyệt vời! "{post_title}" vừa được chia sẻ với cộng đồng. Hãy xem mọi người phản ứng như thế nào nhé!',
    action_text: 'Xem bài viết',
    variables: ['post_title', 'post_url'],
    icon: 'check_circle',
    color: 'success',
  },
  {
    event: 'POST_SUCCESS',
    tone: 'formal',
    title: 'Bài đăng đã được xuất bản thành công',
    message: 'Bài viết "{post_title}" của bạn hiện đã có sẵn trên nền tảng. Bạn có thể theo dõi tương tác của người dùng trong mục Hoạt động.',
    action_text: 'Xem chi tiết',
    variables: ['post_title', 'post_url'],
    icon: 'publish',
    color: 'info',
  },
  {
    event: 'POST_SUCCESS',
    tone: 'concise',
    title: 'Đã đăng: {post_title}',
    message: 'Bài viết của bạn đã được chia sẻ.',
    action_text: 'Mở',
    variables: ['post_title', 'post_url'],
    icon: 'done',
    color: 'success',
  },
  {
    event: 'POST_AI_SUCCESS',
    tone: 'friendly',
    title: '✨ Tác phẩm AI của bạn đã sẵn sàng!',
    message: 'Hình ảnh AI "{post_title}" vừa được lưu thành công. Hãy xem những phản ứng từ cộng đồng!',
    action_text: 'Xem bây giờ',
    variables: ['post_title', 'post_url'],
    icon: 'auto_awesome',
    color: 'success',
  },
  {
    event: 'POST_AI_SUCCESS',
    tone: 'formal',
    title: 'Hình ảnh AI được lưu thành công',
    message: 'Tác phẩm "{post_title}" của bạn đã được xử lý và chia sẻ. Bạn có thể tìm thấy nó trong thư viện của mình.',
    action_text: 'Truy cập',
    variables: ['post_title', 'post_url'],
    icon: 'extension',
    color: 'info',
  },
  {
    event: 'POST_AI_SUCCESS',
    tone: 'concise',
    title: 'AI tác phẩm đã lưu',
    message: '"{post_title}" sẵn sàng để chia sẻ.',
    action_text: 'Xem',
    variables: ['post_title', 'post_url'],
    icon: 'done',
    color: 'success',
  },
  {
    event: 'LIKE',
    tone: 'friendly',
    title: '❤️ {actor_name} thích bài của bạn!',
    message: '{actor_name} vừa nhấn thích "{post_title}". Cảm ơn sự ủng hộ! 🙌',
    action_text: 'Xem bài viết',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'favorite',
    color: 'danger',
  },
  {
    event: 'LIKE',
    tone: 'formal',
    title: '{actor_name} đã thích bài viết của bạn',
    message: 'Người dùng {actor_name} vừa thích "{post_title}". Hãy xem bài viết của bạn nhận được bao nhiêu lượt yêu thích.',
    action_text: 'Xem chi tiết',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'thumb_up',
    color: 'info',
  },
  {
    event: 'LIKE',
    tone: 'concise',
    title: '{actor_name} thích bài của bạn',
    message: '"{post_title}" vừa được thích.',
    action_text: 'Xem',
    variables: ['actor_name', 'post_title', 'post_url'],
    icon: 'favorite',
    color: 'danger',
  },
  {
    event: 'COMMENT',
    tone: 'friendly',
    title: '💬 {actor_name} đã bình luận!',
    message: '{actor_name} vừa bình luận trên "{post_title}". Hãy xem họ nói gì!',
    action_text: 'Trả lời',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'chat_bubble',
    color: 'primary',
  },
  {
    event: 'COMMENT',
    tone: 'formal',
    title: '{actor_name} bình luận trên bài viết của bạn',
    message: 'Bạn có bình luận mới từ {actor_name} trên "{post_title}". Hãy tham gia cuộc trò chuyện.',
    action_text: 'Xem bình luận',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'comment',
    color: 'info',
  },
  {
    event: 'COMMENT',
    tone: 'concise',
    title: '{actor_name} bình luận',
    message: 'Có bình luận mới trên "{post_title}".',
    action_text: 'Xem',
    variables: ['actor_name', 'post_title', 'post_url'],
    icon: 'chat_bubble',
    color: 'primary',
  },
  {
    event: 'SAVE',
    tone: 'friendly',
    title: '🔖 {actor_name} đã lưu bài của bạn!',
    message: '{actor_name} lưu "{post_title}" vào bộ sưu tập của họ. Điều đó có nghĩa là họ thực sự thích nó! ✨',
    action_text: 'Xem bài viết',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'bookmark',
    color: 'warning',
  },
  {
    event: 'SAVE',
    tone: 'formal',
    title: '{actor_name} đã lưu bài viết của bạn',
    message: 'Bài viết "{post_title}" của bạn vừa được lưu bởi {actor_name}. Điều này cho thấy nó được đánh giá cao.',
    action_text: 'Xem chi tiết',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'save',
    color: 'info',
  },
  {
    event: 'SAVE',
    tone: 'concise',
    title: '{actor_name} lưu bài của bạn',
    message: '"{post_title}" vừa được lưu.',
    action_text: 'Xem',
    variables: ['actor_name', 'post_title', 'post_url'],
    icon: 'bookmark',
    color: 'warning',
  },
  {
    event: 'SHARE',
    tone: 'friendly',
    title: '🚀 {actor_name} chia sẻ bài của bạn!',
    message: '{actor_name} vừa chia sẻ "{post_title}". Tuyệt vời! Bài viết của bạn đang truyền lan! 🎉',
    action_text: 'Xem hoạt động',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'share',
    color: 'success',
  },
  {
    event: 'SHARE',
    tone: 'formal',
    title: '{actor_name} chia sẻ bài viết của bạn',
    message: 'Bài viết "{post_title}" của bạn vừa được chia sẻ bởi {actor_name}. Điều này tăng mức tiếp cận của nó.',
    action_text: 'Xem chi tiết',
    variables: ['actor_name', 'post_title', 'post_url', 'time_ago'],
    icon: 'share',
    color: 'info',
  },
  {
    event: 'SHARE',
    tone: 'concise',
    title: '{actor_name} chia sẻ bài của bạn',
    message: '"{post_title}" vừa được chia sẻ.',
    action_text: 'Xem',
    variables: ['actor_name', 'post_title', 'post_url'],
    icon: 'share',
    color: 'success',
  },
  {
    event: 'MILESTONE_10_LIKES',
    tone: 'friendly',
    title: '🏆 Bài viết của bạn đạt 10 thích!',
    message: '"{post_title}" vừa vượt qua mốc 10 lượt thích. Cộng đồng yêu thích công việc của bạn! 🌟',
    action_text: 'Xem thành tựu',
    variables: ['post_title', 'post_url'],
    icon: 'star',
    color: 'warning',
  },
  {
    event: 'MILESTONE_50_LIKES',
    tone: 'friendly',
    title: '⭐ Bài viết của bạn đạt 50 thích!',
    message: '"{post_title}" đang là xu hướng! Cảm ơn mọi người đã yêu thích bài viết của bạn. 🚀',
    action_text: 'Xem bài viết',
    variables: ['post_title', 'post_url'],
    icon: 'trending_up',
    color: 'success',
  },
];

export class NotificationTemplateHelper {
  static getTemplate(
    event: string,
    tone: NotificationTone = 'friendly'
  ): NotificationTemplate | undefined {
    return NOTIFICATION_TEMPLATES.find(t => t.event === event && t.tone === tone);
  }

  static formatMessage(
    template: NotificationTemplate,
    data: NotificationData
  ): string {
    let message = template.message;
    Object.entries(data).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      if (value) {
        message = message.replace(new RegExp(placeholder, 'g'), value);
      }
    });
    return message;
  }

  static formatTitle(
    template: NotificationTemplate,
    data: NotificationData
  ): string {
    let title = template.title;
    Object.entries(data).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      if (value) {
        title = title.replace(new RegExp(placeholder, 'g'), value);
      }
    });
    return title;
  }

  static selectTone(
    userPreference?: NotificationTone,
    deviceType?: 'mobile' | 'tablet' | 'desktop'
  ): NotificationTone {
    if (userPreference) return userPreference;
    switch (deviceType) {
      case 'mobile':
        return 'concise';
      case 'tablet':
        return 'friendly';
      case 'desktop':
        return 'friendly';
      default:
        return 'friendly';
    }
  }
}
